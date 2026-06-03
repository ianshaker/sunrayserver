const { createClient } = require("@supabase/supabase-js");

// --- КОНСТАНТЫ И СПРАВОЧНИКИ ---
const TELEGRAM_CHAT_ID = -1002582438853;

const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES_TO_CHECK = [
  "dogovorfinished",  // завершённые контракты — высший приоритет
  "dogovornew",       // активные договоры
  "appealsotkaz",     // входящие отказ
  "zamerotkaz",       // замер отказ
  "dobivashki",       // добивашки
  "eventsnew",        // события
  "appeals",          // входящие заявки
];

const TABLE_NAMES = {
    appeals: 'ВХОДЯЩИЕ',
    appealsotkaz: 'ВХОДЯЩИЕ ОТКАЗ',
    dobivashki: 'ДОБИВАШКИ',
    dogovornew: 'ДОГОВОРЫ АКТИВНЫЕ',
    eventsnew: 'СОБЫТИЯ',
    zamerotkaz: 'ЗАМЕР ОТКАЗ',
    dogovorfinished: 'ДОГОВОРЫ ЗАВЕРШЕННЫЕ'
};

const MANAGERS = {
    '79933686717': 'Даша',
    '79936875757': 'Антон',
    '79253860654': 'Антон',
    'mironov1998@vpbx400311913.mangosip.ru': 'Ян',
    'mironov1998': 'Ян',
    'gennady@vpbx400311913.mangosip.ru': 'Гена',
    'gennady': 'Гена',
    '79309435755': 'Гена',
    'gleb@vpbx400311913.mangosip.ru': 'Мякинина',
    'gleb': 'Мякинина',
    '79891930450': 'Юля',
    'elena@vpbx400311913.mangosip.ru': 'Настя',
    'elena': 'Настя',
    'svetlanamanager@vpbx400311913.mangosip.ru': 'Света',
    'svetlanamanager': 'Света'
};

const COMPANY_LINES = {
    '79585382001': '🟢 SUNRAY',
    '79852194439': '🔶 DESIGN-SUN',
    '79852196418': '🔵 СЕТКИ'
};

const activeCalls = {}; // call_id: инфо о звонке

// === НОВОЕ: Хранение сообщений в памяти ===
const callMessages = {}; // структура: { phoneNumber: { incomingMessageId: number, foundMessageId: number, connectedMessageId: number, dialoutMessageIds: [], managers: [], acceptedManager: null, callData: object, createdAppealId: null } }

function formatPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return 'Неизвестный номер';
    if (phone.includes('@')) return phone.replace('sip:', '').split('@')[0];
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
        return `8(${digits.substring(1, 4)})${digits.substring(4, 7)}-${digits.substring(7, 9)}-${digits.substring(9, 11)}`;
    }
    if (digits.length === 10) {
        return `8(${digits.substring(0, 3)})${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
    }
    return phone;
}

function getCompanyLineName(phone) {
    if (!phone) return 'Неизвестная линия';
    return COMPANY_LINES[phone] ? `Линия сайта ${COMPANY_LINES[phone]}` : `Линия ${phone}`;
}

function isManager(phone) {
    if (!phone) return false;
    let lookup = phone;
    if (phone.includes('@')) lookup = phone.replace('sip:', '');
    return MANAGERS[lookup] !== undefined;
}

function getManagerName(phone) {
    if (!phone) return 'Неизвестно';
    let lookup = phone;
    if (phone.includes('@')) lookup = phone.replace('sip:', '');
    return MANAGERS[lookup] || 'Неизвестно';
}

function isOutgoingCall(data) {
    if (data.call_direction === 2) return true;
    if (isManager(data.from?.number)) return true;
    return false;
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 сек';
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')} мин` : `${sec} сек`;
}

// === Поиск клиента во ВСЕХ таблицах, возвращает массив всех совпадений === //
async function findAllClientInfoByPhone(phone) {
    const results = [];
    const searchNumber = phone.trim();
    const clearSearch = searchNumber.replace(/\D/g, '');

    for (const table of TABLES_TO_CHECK) {
        let fields = [];
        switch (table) {
            case "dogovorfinished":
            case "dogovornew":
                fields = ["appeal_id", "dogovor_date", "dogovor_number", "city", "client_name", "phone", "total_numbers"];
                break;
            case "appeals":
            case "appealsotkaz":
            case "dobivashki":
            case "zamerotkaz":
                fields = ["appeal_number", "client_name", "phone", "city", "dialog"];
                break;
            case "eventsnew":
                fields = ["appeal_number", "type", "client_name", "phone", "city", "dialog", "master", "date", "start_time", "end_time"];
                break;
            default:
                continue;
        }

        const { data, error } = await supabase
            .from(table)
            .select(fields.join(","))
            .ilike('phone', `%${searchNumber}%`)
            .limit(1);

        if (error) continue;
        if (!data || data.length === 0) continue;

        const foundRow = data.find(row =>
            row.phone &&
            row.phone
                .split(/[,\.]/)
                .map(p => p.replace(/\s/g, '').replace(/\D/g, ''))
                .some(num => num === clearSearch)
        );

        if (foundRow) results.push({ table, info: foundRow });
    }

    return results;
}

const NUMBER_EMOJI = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣'];

// === Построение текста карточки найденной записи === //
// index + phone передаются при звонке (Appeared), не передаются в саммари
function buildFoundInfoMessage(found, index = null, phone = null) {
    const sectionName = TABLE_NAMES[found.table] || found.table;
    const emoji = index !== null ? (NUMBER_EMOJI[index] || `${index + 1}.`) : 'ℹ️';
    let msg = index !== null
        ? `${emoji} Соответствие к <b>${phone}</b>\n<b>${sectionName}</b>\n`
        : `ℹ️ <b>${sectionName}</b>\n`;

    switch (found.table) {
        case "dogovorfinished":
        case "dogovornew":
            msg +=
                `ID обращения: <b>${found.info.appeal_id}</b>\n` +
                `Номер договора: <b>${found.info.dogovor_number || ""}</b>\n` +
                `Дата договора: <b>${found.info.dogovor_date || ""}</b>\n` +
                `Клиент: <b>${found.info.client_name || ""}</b>\n` +
                `Город: <b>${found.info.city || ""}</b>\n` +
                (found.info.total_numbers ? `Изделий: <b>${found.info.total_numbers}</b>\n` : '');
            break;
        case "appeals":
        case "appealsotkaz":
        case "dobivashki":
        case "zamerotkaz":
            msg +=
                `Номер: <b>${found.info.appeal_number}</b>\n` +
                `Клиент: <b>${found.info.client_name || ""}</b>\n` +
                `Город: <b>${found.info.city || ""}</b>\n` +
                (found.info.dialog ? `Диалог: <i>${found.info.dialog}</i>\n` : '');
            break;
        case "eventsnew":
            msg +=
                `Номер: <b>${found.info.appeal_number}</b>\n` +
                `Тип: <b>${found.info.type || ""}</b>\n` +
                `Клиент: <b>${found.info.client_name || ""}</b>\n` +
                `Город: <b>${found.info.city || ""}</b>\n` +
                `Мастер: <b>${found.info.master || ""}</b>\n` +
                `Дата: <b>${found.info.date || ""}</b>\n` +
                `Время: <b>${found.info.start_time || ""}-${found.info.end_time || ""}</b>\n` +
                (found.info.dialog ? `Диалог: <i>${found.info.dialog}</i>\n` : '');
            break;
        default:
            msg += "(нет данных)\n";
    }

    return msg;
}

// === Создание итогового сообщения (принимает массив всех найденных записей) === //
function createFinalCallMessage(callData, foundInfoList, duration, createdAppealId) {
    const { formattedFromNumber, lineName, managers, acceptedManager } = callData;

    let finalMsg = `📞 <b>ЗАВЕРШЕННЫЙ ЗВОНОК</b>\n`;
    finalMsg += `Абонент: <b>${formattedFromNumber}</b>\n`;
    finalMsg += `${lineName}\n`;

    if (managers && managers.length > 0) {
        finalMsg += managers.length === 1
            ? `Звонок менеджеру: <b>${managers[0]}</b>\n`
            : `Дозвон: <b>${managers.join(' → ')}</b>\n`;
    }

    finalMsg += acceptedManager
        ? `Принял: <b>${acceptedManager}</b> (${formatDuration(duration)})\n`
        : `Не принят (${formatDuration(duration)})\n`;

    if (foundInfoList && foundInfoList.length > 0) {
        finalMsg += `\n📋 <b>История клиента (${foundInfoList.length} запис${foundInfoList.length === 1 ? 'ь' : 'и'}):</b>\n`;
        for (const found of foundInfoList) {
            finalMsg += `\n` + buildFoundInfoMessage(found);
        }
    } else {
        finalMsg += `\n📋 <b>Создана новая заявка</b>\n`;
        if (createdAppealId) {
            finalMsg += `Номер заявки: <b>${createdAppealId}</b>\n`;
        }
    }

    return finalMsg;
}

async function handleMangoWebhook(request, reply, telegramBot) {
    let body = request.body || {};

    if (typeof body.json === "string") {
        try {
            body = { ...body, ...JSON.parse(body.json) };
        } catch (e) {
            return reply.code(400).send({ error: "Bad json" });
        }
    }

    // === ИТОГ ЗВОНКА (когда звонок завершился) ===
    if (body.hasOwnProperty('call_direction') && body.hasOwnProperty('from') && body.hasOwnProperty('to')) {
        if (isOutgoingCall(body)) return reply.send({ status: "outgoing_ignored" });

        const fromNumber = body.from?.number;
        const toNumber = body.to?.number;
        const lineNumber = body.line_number;
        const talkTime = body.talk_time || 0;
        const endTime = body.end_time || 0;
        const duration = talkTime && endTime ? endTime - talkTime : 0;
        const formattedFromNumber = formatPhoneNumber(fromNumber);

        // === НОВАЯ ЛОГИКА: Проверяем есть ли сохраненные сообщения для этого номера ===
        const messageData = callMessages[formattedFromNumber];
        
        if (messageData) {
            // Удаляем все промежуточные сообщения
            try {
                const toDelete = [
                    messageData.incomingMessageId,
                    messageData.aiSearchMessageId,
                    messageData.aiEndMessageId,
                    messageData.connectedMessageId,
                    ...(messageData.foundMessageIds || []),
                    ...(messageData.dialoutMessageIds || []),
                ];
                for (const msgId of toDelete) {
                    if (msgId) await telegramBot.deleteMessage(TELEGRAM_CHAT_ID, msgId);
                }
            } catch (e) {
                console.log("Ошибка при удалении сообщений:", e.message);
            }

            // Создаем итоговое сообщение со всей историей клиента
            const finalMessage = createFinalCallMessage(messageData.callData, messageData.foundInfoList, duration, messageData.createdAppealId);
            await telegramBot.sendMessage(TELEGRAM_CHAT_ID, finalMessage, { parse_mode: "HTML" });
            
            // Удаляем данные из памяти
            delete callMessages[formattedFromNumber];
        } else {
            // Если нет сохраненных данных, отправляем стандартное сообщение
            const lineName = getCompanyLineName(lineNumber);
            let managerName = getManagerName(toNumber);
            await telegramBot.sendMessage(
                TELEGRAM_CHAT_ID,
                `✅ <b>ИТОГ ЗВОНКА</b> ${formattedFromNumber}\n${lineName}\nМенеджер: <b>${managerName}</b> (${formatDuration(duration)})`,
                { parse_mode: "HTML" }
            );
        }

        return reply.send({ status: "summary_sent" });
    }

    const callState = body.call_state;
    const callId = body.call_id || body.entry_id;
    const fromNumber = body.from?.number;
    const toNumber = body.to?.number;
    const lineNumber = body.to?.line_number;
    const location = body.location;
    const seq = body.seq;

    // Appeared — новый входящий звонок или дозвон
    if (callState === "Appeared" && location === "abonent" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const formattedToNumber = formatPhoneNumber(toNumber);
        const managerName = getManagerName(toNumber);

        // === ПРОВЕРЯЕМ: это новый звонок или дозвон? ===
        if (callMessages[formattedFromNumber]) {
            // Это дозвон к другому менеджеру
            const dialoutMessage = await telegramBot.sendMessage(
                TELEGRAM_CHAT_ID,
                `Дозвон менеджеру ${managerName}`,
                { parse_mode: "HTML" }
            );
            
            // Добавляем менеджера в список и ID сообщения о дозвоне
            callMessages[formattedFromNumber].dialoutMessageIds.push(dialoutMessage.message_id);
            callMessages[formattedFromNumber].callData.managers.push(managerName);
            
            return reply.send({ status: "dialout_processed" });
        }

        // === Это новый звонок ===
        if (activeCalls[callId]) return reply.send({ status: "already_appeared" });
        activeCalls[callId] = true;

        const lineName = getCompanyLineName(lineNumber);

        // === ОТПРАВЛЯЕМ ПЕРВОЕ СООБЩЕНИЕ И СОХРАНЯЕМ ЕГО ID ===
        const incomingMessage = await telegramBot.sendMessage(
            TELEGRAM_CHAT_ID,
            `📞 <b>ВХОДЯЩИЙ ЗВОНОК</b>\nАбонент: <b>${formattedFromNumber}</b>\n${lineName}\nЗвонок менеджеру: ${formattedToNumber} (${managerName})`,
            { parse_mode: "HTML" }
        );

        // === ИНИЦИАЛИЗИРУЕМ ДАННЫЕ В ПАМЯТИ ===
        callMessages[formattedFromNumber] = {
            incomingMessageId: incomingMessage.message_id,
            aiSearchMessageId: null,   // "Ищу в базе..."
            aiEndMessageId: null,      // "Это всё что нашёл" / "Ничего не нашёл"
            foundMessageIds: [],
            connectedMessageId: null,
            dialoutMessageIds: [],
            foundInfoList: [],
            createdAppealId: null,
            callData: {
                formattedFromNumber,
                lineName,
                managers: [managerName],
                acceptedManager: null
            }
        };

        // === AI-имитация: сообщение о начале поиска ===
        const searchMsg = await telegramBot.sendMessage(
            TELEGRAM_CHAT_ID,
            `🔍 Ищу <b>${formattedFromNumber}</b> по базам данных...`,
            { parse_mode: "HTML" }
        );
        callMessages[formattedFromNumber].aiSearchMessageId = searchMsg.message_id;

        // === Поиск во ВСЕХ таблицах, отправляем каждую находку сразу === //
        const foundList = await findAllClientInfoByPhone(formattedFromNumber);

        if (foundList.length > 0) {
            for (let i = 0; i < foundList.length; i++) {
                const replyMsg = buildFoundInfoMessage(foundList[i], i, formattedFromNumber);
                const foundMessage = await telegramBot.sendMessage(TELEGRAM_CHAT_ID, replyMsg, { parse_mode: "HTML" });
                callMessages[formattedFromNumber].foundMessageIds.push(foundMessage.message_id);
                if (i < foundList.length - 1) await new Promise(r => setTimeout(r, 400));
            }
            callMessages[formattedFromNumber].foundInfoList = foundList;

            // AI: итог поиска
            const n = foundList.length;
            const endMsg = await telegramBot.sendMessage(
                TELEGRAM_CHAT_ID,
                `✅ Это всё что нашёл по клиенту — <b>${n}</b> ${n === 1 ? 'запись' : 'записи'}`,
                { parse_mode: "HTML" }
            );
            callMessages[formattedFromNumber].aiEndMessageId = endMsg.message_id;

        } else {
            // AI: ничего не нашёл, сообщаем до создания заявки
            const endMsg = await telegramBot.sendMessage(
                TELEGRAM_CHAT_ID,
                `📝 По номеру <b>${formattedFromNumber}</b> ничего не нашёл. Создаю новую заявку...`,
                { parse_mode: "HTML" }
            );
            callMessages[formattedFromNumber].aiEndMessageId = endMsg.message_id;

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
                const errorMessage = await telegramBot.sendMessage(
                    TELEGRAM_CHAT_ID,
                    `❌ <b>Ошибка при получении айди</b>\n${e.message}`,
                    { parse_mode: "HTML" }
                );
                callMessages[formattedFromNumber].foundMessageIds.push(errorMessage.message_id);
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
                reminder_date: null,
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

                const successMessage = await telegramBot.sendMessage(
                    TELEGRAM_CHAT_ID,
                    `✅ <b>Заявка успешно создана</b>\n${formattedFromNumber}\nНомер заявки: <b>${appeal_id}</b>`,
                    { parse_mode: "HTML" }
                );
                callMessages[formattedFromNumber].foundMessageIds.push(successMessage.message_id);
                callMessages[formattedFromNumber].createdAppealId = appeal_id;

            } catch (e) {
                const errorMessage = await telegramBot.sendMessage(
                    TELEGRAM_CHAT_ID,
                    `❌ <b>Ошибка создания заявки</b>\n${formattedFromNumber}\n${e.message}`,
                    { parse_mode: "HTML" }
                );
                callMessages[formattedFromNumber].foundMessageIds.push(errorMessage.message_id);
                return reply.code(500).send({ error: "insert_error" });
            }
        }
        return reply.send({ status: "appeared_processed" });
    }

    // Connected — звонок принят менеджером
    if (callState === "Connected" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const managerName = getManagerName(toNumber);

        // === СОХРАНЯЕМ ИНФОРМАЦИЮ О ТОМ, КТО ПРИНЯЛ ЗВОНОК ===
        if (callMessages[formattedFromNumber]) {
            callMessages[formattedFromNumber].callData.acceptedManager = managerName;
        }

        const connectedMessage = await telegramBot.sendMessage(
            TELEGRAM_CHAT_ID,
            `✅ <b>ЗВОНОК ПРИНЯТ</b> (${managerName})\nАбонент: <b>${formattedFromNumber}</b>\n<i>Я сообщу когда менеджер завершит диалог</i>`,
            { parse_mode: "HTML" }
        );

        // === СОХРАНЯЕМ ID СООБЩЕНИЯ "ЗВОНОК ПРИНЯТ" ===
        if (callMessages[formattedFromNumber]) {
            callMessages[formattedFromNumber].connectedMessageId = connectedMessage.message_id;
        }

        return reply.send({ status: "connected" });
    }

    if (callState === "Disconnected" && activeCalls[callId]) {
        delete activeCalls[callId];
        return reply.send({ status: "disconnected" });
    }

    return reply.send({ status: "not_handled" });
}

module.exports = { handleMangoWebhook };
