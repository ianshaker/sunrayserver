const { supabase } = require("../lib/supabaseClient");
const { getMskTodayDate } = require("../appeals-deadlines/queries");
const { TELEGRAM_CHAT_ID } = require("./constants");
const {
    activeCalls,
    entryCallMeta,
    callMessages,
    otmetitZavershenie,
    zvonokUzheZavershen,
    otlozhitSessiyu,
    dostatOtlozhennuyu,
    zabytOtlozhennuyu,
} = require("./state");
const { logMangoWebhook } = require("./logging");
const { CallCard } = require("./callCard");
const { renderCallCard } = require("./renderCallCard");
const {
    formatPhoneNumber,
    getCompanyLineName,
    resolveLineNumber,
    getDisconnectLabel,
    buildCallTiming,
    getEventTimestamp,
    closeCurrentManagerLeg,
    startManagerLeg,
    markManagerLegConnected,
    finalizeManagerLegs,
    isManager,
    getManagerName,
    isOutgoingCall,
    getAppealSourceByLine,
} = require("./format");
const { findAllClientInfoByPhone } = require("./crmLookup");
const { saveCallSummary } = require("./db");

async function syncSessionCard(telegramBot, session) {
    if (!session.card) {
        session.card = new CallCard(TELEGRAM_CHAT_ID);
    }
    await session.card.sync(telegramBot, renderCallCard(session));
}

// Свободный номер заявки из ids. Бросает при ошибке базы и когда свободных номеров нет.
async function vzyatSvobodnyyNomerZayavki() {
    const { data: ids, error: idError } = await supabase
        .from("ids")
        .select("appeal_id")
        .eq("is_used", false)
        .is('used_at', null)
        .order("id", { ascending: true })
        .limit(1);
    if (idError) throw idError;
    if (!ids || !ids.length) throw new Error("Нет свободных айди!");
    return ids[0].appeal_id;
}

// Пометить номер занятым и записать источник (ошибка не мешает создать заявку — как и раньше).
async function zanyatNomerZayavki(appeal_id, appealSource) {
    try {
        const used_at = new Date().toISOString();
        await supabase
            .from("ids")
            .update({ is_used: true, used_at, source: appealSource })
            .eq("appeal_id", appeal_id);
    } catch {}
}

// Заявка нового клиента по входящему звонку (поля те же, что всегда).
function sobratZayavkuNovogoKlienta({ appeal_id, formattedFromNumber, managerName, appealSource }) {
    return {
        appeal_number: appeal_id,
        client_name: "",
        phone: formattedFromNumber,
        city: "",
        address: "",
        detailed_address: "",
        source: appealSource,
        manager: managerName,
        dialog: "",
        reminder_date: getMskTodayDate(),
        reminder_time: null,
        task_description: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "Активно",
        product_type: "Продукт не указан"
    };
}

// Заявка новому клиенту по Appeared, у которого карточку Telegram заводить не надо. Три пути сюда:
// поздний повтор из очереди прокси (журнал выставил request.mangoBezTelegram), звонок, итог которого уже пришёл
// (память «звонок закончен»), и итог, забравший сессию, пока этот же Appeared искал клиента.
// Поиск клиента и создание заявки — те же помощники, что в живой ветке. Бросает при ошибке базы.
async function zayavkaBezTelegram({ formattedFromNumber, managerName, lineNumber }) {
    const foundList = await findAllClientInfoByPhone(formattedFromNumber);
    if (foundList.length > 0) return { status: "client_found" };

    const appeal_id = await vzyatSvobodnyyNomerZayavki();
    const appealSource = getAppealSourceByLine(lineNumber);
    await zanyatNomerZayavki(appeal_id, appealSource);

    const { error } = await supabase
        .from("appeals")
        .insert([sobratZayavkuNovogoKlienta({ appeal_id, formattedFromNumber, managerName, appealSource })]);
    if (error) throw error;
    return { status: "appeal_created", appeal_id };
}

// Ответ на Appeared, у которого карточки не будет: заявка новому клиенту без Telegram и без сессий.
// Сбой — лог и 503 (прокси дошлёт); sbrosPered503 снимает метки, из-за которых повтор отбросят.
// posleUspekha(itog) — после успешного поиска/заявки, до ответа; сбой ответ не меняет, поэтому должен ловить свои ошибки.
async function otvetZayavkaBezTelegram(reply, dannye, sbrosPered503 = () => {}, posleUspekha = async () => {}) {
    try {
        const itog = await zayavkaBezTelegram(dannye);
        await posleUspekha(itog);
        return reply.send({ status: `appeared_late_${itog.status}` });
    } catch (e) {
        console.log("⚠️ Appeared без карточки: заявка не создана:", e.message);
        sbrosPered503();
        return reply.code(503).send({ error: "late_appeal_failed" });
    }
}

// Сессия карточки того же звонка — единственное место выбора сессии для итога, Connected, Disconnected и дозвона.
// entry_id — устойчивый идентификатор звонка целиком (оба плеча дозвона делят его); сессия лежит по телефону клиента
// (последняя на номере), поэтому там может висеть сессия другого звонка — её не трогаем и ищем свою среди отложенных.
// Если entry_id нет у сессии или у события — как раньше, считаем сессию по телефону своей.
function sessiyaTogoZheZvonka(formattedFromNumber, entryId) {
    const session = callMessages[formattedFromNumber];
    if (session && (!session.entryId || !entryId || session.entryId === entryId)) return session;
    return entryId ? dostatOtlozhennuyu(entryId) : undefined;
}

// Сессию, пока этот обработчик искал клиента или заводил заявку, забрал итог звонка (его карточка уже нарисована без заявки:
// «Клиент не найден в базе, заявка не создавалась») или вытеснил другой звонок с того же номера (карточка так и висит
// «Ищу по базам…» / «Создаю заявку…»). Результат пишем в СВОЮ сессию и перерисовываем её карточку. Сбой перерисовки ответ не меняет.
async function dopisatPozdnyuyuZayavku(telegramBot, session, appeal_id) {
    session.createdAppealId = appeal_id;
    session.crmPhase = "appeal_created";
    try {
        await syncSessionCard(telegramBot, session);
    } catch (e) {
        console.log("⚠️ Карточка после поздней заявки не перерисована:", e.message);
    }
}

// То же для найденного клиента: вытесненная (или забранная итогом) сессия получает историю клиента.
async function dopisatNaydennogoKlienta(telegramBot, session, foundList) {
    session.foundInfoList = foundList;
    session.crmPhase = "found";
    try {
        await syncSessionCard(telegramBot, session);
    } catch (e) {
        console.log("⚠️ Карточка после поиска клиента не перерисована:", e.message);
    }
}

async function handleMangoWebhook(request, reply, telegramBot) {
    const rawBody = request.body ? { ...request.body } : {};
    let body = { ...rawBody };

    if (typeof body.json === "string") {
        try {
            body = { ...body, ...JSON.parse(body.json) };
        } catch (e) {
            logMangoWebhook(request, rawBody, { parse_error: e.message });
            return reply.code(400).send({ error: "Bad json" });
        }
    }

    logMangoWebhook(request, rawBody, body);

    // === ИТОГ ЗВОНКА (когда звонок завершился) ===
    if (body.hasOwnProperty('call_direction') && body.hasOwnProperty('from') && body.hasOwnProperty('to')) {
        const entryId = body.entry_id;

        // === Исходящий звонок: сохраняем в Supabase (история + аудио потом),
        // но без Telegram-чата "входящие" и без расшифровки/нейроанализа
        // (transcript_status/summary_status='skipped' — см. saveCallSummary) ===
        if (isOutgoingCall(body)) {
            if (entryId) delete entryCallMeta[entryId];

            const lineNumber = resolveLineNumber(body, entryId);
            const timing = buildCallTiming(body);
            const disconnectLabel = getDisconnectLabel(body.disconnect_reason);

            let oshibkaSokhraneniya = null;
            try {
                oshibkaSokhraneniya = (await saveCallSummary(body, {
                    timing,
                    disconnectLabel,
                    lineNumber,
                    lineName: getCompanyLineName(lineNumber),
                }))?.error || null;
            } catch (e) {
                console.log("⚠️ Не удалось сохранить исходящий звонок в Supabase:", e.message);
                oshibkaSokhraneniya = e;
            }
            // Не сохранили — 503: прокси дошлёт итог, upsert по entry_id повторяется без вреда.
            if (oshibkaSokhraneniya) return reply.code(503).send({ error: "summary_save_failed" });

            return reply.send({ status: "outgoing_saved" });
        }

        // Звонок закончен: опоздавший Appeared этого звонка живую сессию уже не заведёт (память до 30 минут).
        // Отмечаем до записи в базу — он может прийти, пока итог ещё сохраняется.
        otmetitZavershenie(entryId);

        const fromNumber = body.from?.number;
        const toNumber = body.to?.number;
        const lineNumber = resolveLineNumber(body, entryId);
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const timing = buildCallTiming(body);
        const disconnectLabel = getDisconnectLabel(body.disconnect_reason);
        const managerName = getManagerName(toNumber);

        // === Сохраняем звонок в Supabase (история для CRM) ===
        let oshibkaSokhraneniya = null;
        try {
            oshibkaSokhraneniya = (await saveCallSummary(body, {
                formattedFromNumber,
                timing,
                disconnectLabel,
                managerName,
                acceptedManager: timing.answered ? managerName : null,
                lineNumber,
                lineName: getCompanyLineName(lineNumber),
            }))?.error || null;
        } catch (e) {
            console.log("⚠️ Не удалось сохранить звонок в Supabase:", e.message);
            oshibkaSokhraneniya = e;
        }
        // Не сохранили — 503 до карточки Telegram: прокси дошлёт итог, и повтор отработает целиком один раз
        // (карточку не трогали; метаданные IVR остались, линия определится так же).
        if (oshibkaSokhraneniya) return reply.code(503).send({ error: "summary_save_failed" });

        if (entryId) delete entryCallMeta[entryId];

        // Чужую сессию (другой звонок с этого номера) итог не берёт и не удаляет: рисуется отдельная карточка.
        const messageData = sessiyaTogoZheZvonka(formattedFromNumber, entryId);

        const callData = messageData?.callData || {
            formattedFromNumber,
            lineName: getCompanyLineName(lineNumber),
            managers: [managerName],
            acceptedManager: timing.answered ? managerName : null,
        };

        callData.timing = timing;
        callData.disconnectLabel = disconnectLabel;
        if (!callData.lineName || callData.lineName.includes('не определена')) {
            callData.lineName = getCompanyLineName(lineNumber);
        }
        if (timing.answered && !callData.acceptedManager) {
            callData.acceptedManager = managerName;
        }

        if (messageData) {
            callData.formattedFromNumber = messageData.callData.formattedFromNumber;
            callData.lineName = messageData.callData.lineName || callData.lineName;
            callData.managers = messageData.callData.managers;
            callData.managerLegs = messageData.callData.managerLegs;
            callData.currentLegIndex = messageData.callData.currentLegIndex;
            callData.acceptedManager = messageData.callData.acceptedManager
                || (timing.answered ? managerName : null);
            callData.timing = timing;
            callData.disconnectLabel = disconnectLabel;
            finalizeManagerLegs(callData, body.end_time);

            messageData.callData = callData;
            messageData.finished = true;
            messageData.crmPhase = messageData.foundInfoList?.length
                ? "found"
                : messageData.createdAppealId
                    ? "appeal_created"
                    : null;

            await syncSessionCard(telegramBot, messageData);
            // Использованную сессию убираем отовсюду: из слота телефона (если она там; пока карточка уходила, на этом
            // номере мог начаться другой звонок и занять место — его сессию не трогаем) и из отложенных.
            if (callMessages[formattedFromNumber] === messageData) delete callMessages[formattedFromNumber];
            zabytOtlozhennuyu(entryId);
        } else {
            // Живой сессии нет: Появился опоздал и пришёл после конца звонка (или сервер перезапускали). Карточка без
            // поиска писала «Клиент не найден в базе», хотя клиент был, — ищем по базе сами. Сбой поиска итог не роняет.
            let foundInfoList = [];
            try {
                foundInfoList = await findAllClientInfoByPhone(formattedFromNumber);
            } catch (e) {
                console.log("⚠️ Итог звонка без сессии: поиск клиента не удался:", e.message);
            }
            const session = {
                callData,
                foundInfoList,
                createdAppealId: null,
                crmPhase: foundInfoList.length ? "found" : null,
                errorNote: null,
                finished: true,
            };
            await syncSessionCard(telegramBot, session);
        }

        return reply.send({ status: "summary_sent" });
    }

    const callState = body.call_state;
    const callId = body.call_id || body.entry_id;
    const entryId = body.entry_id;
    const fromNumber = body.from?.number;
    const toNumber = body.to?.number;
    const location = body.location;

    // IVR — звонок поступил на номер компании (фиксируем линию заранее)
    if (callState === "Appeared" && location === "ivr" && !isManager(fromNumber)) {
        const lineNum = body.to?.line_number || body.to?.number;
        entryCallMeta[entryId] = {
            formattedFromNumber: formatPhoneNumber(fromNumber),
            lineNumber: lineNum,
            lineName: getCompanyLineName(lineNum),
            ivrAppearedAt: body.timestamp || 0,
        };
        return reply.send({ status: "ivr_registered" });
    }

    const lineNumber = resolveLineNumber(body, entryId);

    // Appeared — дозвон менеджеру (новый звонок или переадресация)
    if (callState === "Appeared" && location === "abonent" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const managerName = getManagerName(toNumber);

        // Поздний повтор из очереди прокси или звонок, итог которого уже пришёл (журнал мог этого не увидеть:
        // итог обработан, пока Appeared писал строку в журнал): только заявка новому клиенту, без карточки и без сессий в памяти.
        if (request.mangoBezTelegram === true || zvonokUzheZavershen(entryId)) {
            return otvetZayavkaBezTelegram(reply, { formattedFromNumber, managerName, lineNumber });
        }

        // === ПРОВЕРЯЕМ: это новый звонок или дозвон? ===
        // Дозвон (второе плечо того же звонка) — когда есть сессия этого звонка: по телефону или среди отложенных
        // (её мог вытеснить с номера другой звонок). Ведём его на ней, а не на callMessages[телефон].
        const svoyaSessiya = sessiyaTogoZheZvonka(formattedFromNumber, entryId);
        if (svoyaSessiya) {
            svoyaSessiya.callData.managers.push(managerName);
            startManagerLeg(
                svoyaSessiya.callData,
                managerName,
                getEventTimestamp(body)
            );
            await syncSessionCard(telegramBot, svoyaSessiya);
            return reply.send({ status: "dialout_processed" });
        }

        // === Это новый звонок ===
        if (activeCalls[callId]) return reply.send({ status: "already_appeared" });
        activeCalls[callId] = true;

        const ivrMeta = entryId && entryCallMeta[entryId];
        const lineName = ivrMeta?.lineName || getCompanyLineName(lineNumber);

        const session = {
            card: new CallCard(TELEGRAM_CHAT_ID),
            entryId,
            crmPhase: "searching",
            foundInfoList: [],
            createdAppealId: null,
            errorNote: null,
            finished: false,
            callData: {
                formattedFromNumber,
                lineName,
                managers: [managerName],
                acceptedManager: null,
                managerLegs: [],
                currentLegIndex: -1,
            },
        };
        // Сессия другого звонка на этом номере ещё жива (итог не пришёл): не удаляем, а откладываем под её entry_id —
        // её события найдут сессию там, телефон остаётся индексом «последняя сессия» и теперь указывает на новый звонок.
        const staraya = callMessages[formattedFromNumber];
        if (staraya) otlozhitSessiyu(staraya);
        callMessages[formattedFromNumber] = session;
        // Перед ответом 5xx: прокси дошлёт это же событие. Сессию и метку звонка убираем (чужую сессию того же номера не трогаем),
        // иначе повтор примут за дозвон другому менеджеру или за «already_appeared», и заявка так и не создастся.
        // Сессия могла уже уйти с номера в отложенные (её вытеснил другой звонок) — оттуда тоже.
        const sbrositSessiyu = () => {
            if (callMessages[formattedFromNumber] === session) delete callMessages[formattedFromNumber];
            if (dostatOtlozhennuyu(entryId) === session) zabytOtlozhennuyu(entryId);
            delete activeCalls[callId];
        };

        const ts = getEventTimestamp(body);
        const ivrPrep = ivrMeta?.ivrAppearedAt && ts > ivrMeta.ivrAppearedAt
            ? ts - ivrMeta.ivrAppearedAt
            : 0;
        startManagerLeg(session.callData, managerName, ts, ivrPrep);

        await syncSessionCard(telegramBot, session);

        // === Поиск во ВСЕХ таблицах === //
        const foundList = await findAllClientInfoByPhone(formattedFromNumber);

        // Summary мог уже забрать сессию (или её заняла сессия другого звонка), пока искали. Клиент найден — заявка не нужна,
        // историю клиента дописываем на карточку своей сессии. Не найден — заявку теперь заведёт только этот обработчик:
        // тем же путём, что поздний повтор, без новой карточки; номер заявки дописываем на карточку своей сессии
        // (нарисованную итогом «заявка не создавалась» или всё ещё «Ищу по базам…», если сессию вытеснил другой звонок).
        if (callMessages[formattedFromNumber] !== session) {
            if (foundList.length > 0) {
                await dopisatNaydennogoKlienta(telegramBot, session, foundList);
                return reply.send({ status: "appeared_processed" });
            }
            return otvetZayavkaBezTelegram(reply, { formattedFromNumber, managerName, lineNumber }, sbrositSessiyu, (itog) =>
                itog.status === "appeal_created" ? dopisatPozdnyuyuZayavku(telegramBot, session, itog.appeal_id) : undefined
            );
        }

        if (foundList.length > 0) {
            session.foundInfoList = foundList;
            session.crmPhase = "found";
            await syncSessionCard(telegramBot, session);
        } else {
            session.crmPhase = "creating_appeal";
            await syncSessionCard(telegramBot, session);

            // Клиент не найден нигде — создаём новую заявку
            let appeal_id = null;
            try {
                appeal_id = await vzyatSvobodnyyNomerZayavki();
            } catch (e) {
                if (!callMessages[formattedFromNumber]) {
                    sbrositSessiyu();
                    return reply.code(500).send({ error: "id_error" });
                }
                session.errorNote = `Ошибка при получении айди\n${e.message}`;
                session.crmPhase = null;
                await syncSessionCard(telegramBot, session);
                sbrositSessiyu();
                return reply.code(500).send({ error: "id_error" });
            }

            // Источник заявки по линии: дизайн-сановская линия — DESIGN-SUN,
            // все остальные — обычный «Звонок». Пишем сразу и в ids: оттуда
            // аналитика считает обращения по источникам.
            const appealSource = getAppealSourceByLine(lineNumber);

            await zanyatNomerZayavki(appeal_id, appealSource);

            const newAppeal = sobratZayavkuNovogoKlienta({ appeal_id, formattedFromNumber, managerName, appealSource });

            console.log("Попытка создания новой заявки в appeals:", newAppeal);

            try {
                const { data, error } = await supabase.from("appeals").insert([newAppeal]);
                console.log("Результат вставки в appeals:", { data, error });
                // supabase-js ошибку не бросает, а возвращает: без этой строки карточка писала «заявка создана» при сбое
                if (error) throw error;

                if (callMessages[formattedFromNumber] !== session) {
                    // Итог забрал сессию (или её вытеснил другой звонок), пока вставлялась заявка: карточка без заявки — дописываем номер.
                    await dopisatPozdnyuyuZayavku(telegramBot, session, appeal_id);
                    return reply.send({ status: "appeared_processed" });
                }
                session.createdAppealId = appeal_id;
                session.crmPhase = "appeal_created";
                session.errorNote = null;
                await syncSessionCard(telegramBot, session);
            } catch (e) {
                if (!callMessages[formattedFromNumber]) {
                    sbrositSessiyu();
                    return reply.code(503).send({ error: "insert_error" });
                }
                session.errorNote = `Ошибка создания заявки\n${formattedFromNumber}\n${e.message}`;
                session.crmPhase = null;
                await syncSessionCard(telegramBot, session);
                sbrositSessiyu();
                return reply.code(503).send({ error: "insert_error" });
            }
        }
        return reply.send({ status: "appeared_processed" });
    }

    // Connected — звонок принят менеджером
    if (callState === "Connected" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const managerName = getManagerName(toNumber);
        const session = sessiyaTogoZheZvonka(formattedFromNumber, entryId);

        if (session) {
            session.callData.acceptedManager = managerName;
            markManagerLegConnected(
                session.callData,
                getEventTimestamp(body)
            );
            closeCurrentManagerLeg(
                session.callData,
                getEventTimestamp(body),
                true
            );
            await syncSessionCard(telegramBot, session);
        }

        return reply.send({ status: "connected" });
    }

    if (callState === "Disconnected" && location === "abonent" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const session = sessiyaTogoZheZvonka(formattedFromNumber, entryId);
        if (session) {
            closeCurrentManagerLeg(
                session.callData,
                getEventTimestamp(body)
            );
            await syncSessionCard(telegramBot, session);
        }
        if (activeCalls[callId]) delete activeCalls[callId];
        return reply.send({ status: "disconnected" });
    }

    if (callState === "Disconnected" && activeCalls[callId]) {
        delete activeCalls[callId];
        return reply.send({ status: "disconnected" });
    }

    return reply.send({ status: "not_handled" });
}

module.exports = { handleMangoWebhook };
