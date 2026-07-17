const { supabase } = require("../lib/supabaseClient");
const { getMskTodayDate } = require("../appeals-deadlines/queries");
const { TELEGRAM_CHAT_ID } = require("./constants");
const { activeCalls, entryCallMeta, callMessages } = require("./state");
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
} = require("./format");
const { findAllClientInfoByPhone } = require("./crmLookup");
const { saveCallSummary } = require("./db");

async function syncSessionCard(telegramBot, session) {
    if (!session.card) {
        session.card = new CallCard(TELEGRAM_CHAT_ID);
    }
    await session.card.sync(telegramBot, renderCallCard(session));
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

            try {
                await saveCallSummary(body, {
                    timing,
                    disconnectLabel,
                    lineNumber,
                    lineName: getCompanyLineName(lineNumber),
                });
            } catch (e) {
                console.log("⚠️ Не удалось сохранить исходящий звонок в Supabase:", e.message);
            }

            return reply.send({ status: "outgoing_saved" });
        }

        const fromNumber = body.from?.number;
        const toNumber = body.to?.number;
        const lineNumber = resolveLineNumber(body, entryId);
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const timing = buildCallTiming(body);
        const disconnectLabel = getDisconnectLabel(body.disconnect_reason);
        const managerName = getManagerName(toNumber);

        if (entryId) delete entryCallMeta[entryId];

        // === Сохраняем звонок в Supabase (история для CRM) — не блокирует Telegram ===
        try {
            await saveCallSummary(body, {
                formattedFromNumber,
                timing,
                disconnectLabel,
                managerName,
                acceptedManager: timing.answered ? managerName : null,
                lineNumber,
                lineName: getCompanyLineName(lineNumber),
            });
        } catch (e) {
            console.log("⚠️ Не удалось сохранить звонок в Supabase:", e.message);
        }

        const messageData = callMessages[formattedFromNumber];

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
            delete callMessages[formattedFromNumber];
        } else {
            const session = {
                callData,
                foundInfoList: [],
                createdAppealId: null,
                crmPhase: null,
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

        // === ПРОВЕРЯЕМ: это новый звонок или дозвон? ===
        if (callMessages[formattedFromNumber]) {
            const session = callMessages[formattedFromNumber];
            session.callData.managers.push(managerName);
            startManagerLeg(
                session.callData,
                managerName,
                getEventTimestamp(body)
            );
            await syncSessionCard(telegramBot, session);
            return reply.send({ status: "dialout_processed" });
        }

        // === Это новый звонок ===
        if (activeCalls[callId]) return reply.send({ status: "already_appeared" });
        activeCalls[callId] = true;

        const ivrMeta = entryId && entryCallMeta[entryId];
        const lineName = ivrMeta?.lineName || getCompanyLineName(lineNumber);

        const session = {
            card: new CallCard(TELEGRAM_CHAT_ID),
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
        callMessages[formattedFromNumber] = session;

        const ts = getEventTimestamp(body);
        const ivrPrep = ivrMeta?.ivrAppearedAt && ts > ivrMeta.ivrAppearedAt
            ? ts - ivrMeta.ivrAppearedAt
            : 0;
        startManagerLeg(session.callData, managerName, ts, ivrPrep);

        await syncSessionCard(telegramBot, session);

        // === Поиск во ВСЕХ таблицах === //
        const foundList = await findAllClientInfoByPhone(formattedFromNumber);

        // Summary мог уже забрать сессию, пока искали
        if (!callMessages[formattedFromNumber]) {
            return reply.send({ status: "appeared_processed" });
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
                const { data: ids, error: idError } = await supabase
                    .from("ids")
                    .select("appeal_id")
                    .eq("is_used", false)
                    .is('used_at', null)
                    .order("id", { ascending: true })
                    .limit(1);
                if (idError) throw idError;
                if (!ids || !ids.length) throw new Error("Нет свободных айди!");
                appeal_id = ids[0].appeal_id;
            } catch (e) {
                if (!callMessages[formattedFromNumber]) {
                    return reply.code(500).send({ error: "id_error" });
                }
                session.errorNote = `Ошибка при получении айди\n${e.message}`;
                session.crmPhase = null;
                await syncSessionCard(telegramBot, session);
                return reply.code(500).send({ error: "id_error" });
            }

            try {
                const used_at = new Date().toISOString();
                await supabase
                    .from("ids")
                    .update({ is_used: true, used_at })
                    .eq("appeal_id", appeal_id);
            } catch {}

            const newAppeal = {
                appeal_number: appeal_id,
                client_name: "",
                phone: formattedFromNumber,
                city: "",
                address: "",
                detailed_address: "",
                source: "Звонок",
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

            console.log("Попытка создания новой заявки в appeals:", newAppeal);

            try {
                const { data, error } = await supabase.from("appeals").insert([newAppeal]);
                console.log("Результат вставки в appeals:", { data, error });

                if (!callMessages[formattedFromNumber]) {
                    return reply.send({ status: "appeared_processed" });
                }
                session.createdAppealId = appeal_id;
                session.crmPhase = "appeal_created";
                session.errorNote = null;
                await syncSessionCard(telegramBot, session);
            } catch (e) {
                if (!callMessages[formattedFromNumber]) {
                    return reply.code(500).send({ error: "insert_error" });
                }
                session.errorNote = `Ошибка создания заявки\n${formattedFromNumber}\n${e.message}`;
                session.crmPhase = null;
                await syncSessionCard(telegramBot, session);
                return reply.code(500).send({ error: "insert_error" });
            }
        }
        return reply.send({ status: "appeared_processed" });
    }

    // Connected — звонок принят менеджером
    if (callState === "Connected" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const managerName = getManagerName(toNumber);
        const session = callMessages[formattedFromNumber];

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
        const session = callMessages[formattedFromNumber];
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
