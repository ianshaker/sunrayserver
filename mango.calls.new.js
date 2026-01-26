const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// --- КОНСТАНТЫ И СПРАВОЧНИКИ ---
const TELEGRAM_CHAT_ID = -1002582438853;

const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES_TO_CHECK = [
  "appeals",
  "appealsotkaz",
  "dobivashki",
  "dogovornew",
  "eventsnew",
  "zamerotkaz"
];

const TABLE_NAMES = {
    appeals: 'ВХОДЯЩИЕ',
    appealsotkaz: 'ВХОДЯЩИЕ ОТКАЗ',
    dobivashki: 'ДОБИВАШКИ',
    dogovornew: 'ДОГОВОРЫ АКТИВНЫЕ',
    eventsnew: 'СОБЫТИЯ',
    zamerotkaz: 'ЗАМЕР ОТКАЗ',
    contractsfinalnew: 'ДОГОВОРЫ ЗАВЕРШЕННЫЕ'
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
    'gleb@vpbx400311913.mangosip.ru': 'Таня',
    'gleb': 'Таня',
    '79132646473': 'Таня',
    'elena@vpbx400311913.mangosip.ru': 'Настя',
    'elena': 'Настя',
    'svetlanamanager@vpbx400311913.mangosip.ru': 'Света',
    'svetlanamanager': 'Света'
};

const COMPANY_LINES = {
    '79585382001': '🟢 SUNRAY',
    '79852194439': '🟡 ЖАЛЮЗИ САН',
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

// === 1. Новый поиск в файле contractsfinalnew.json === //
function findContractByPhoneFromFile(phone) {
    try {
        const filePath = path.join(__dirname, "contractsfinalnew.json");
        if (!fs.existsSync(filePath)) return null;
        const contracts = JSON.parse(fs.readFileSync(filePath, "utf8"));
        // ищем строго по совпадению (лучше сравнивать "чистый" номер без лишних символов)
        const clearPhone = phone.replace(/\D/g, '');
        return contracts.find(contract => {
            // ищем по каждому номеру из ячейки с разделителями
            if (!contract.phone) return false;
            return contract.phone
                .split(/[,\.]/)
                .map(p => p.replace(/\s/g, '').replace(/\D/g, ''))
                .some(num => num === clearPhone);
        }) || null;
    } catch (e) {
        return null;
    }
}

// === 2. Обычный поиск в Supabase (кроме dogovorfinished) === //
async function findClientInfoByPhone(phone) {
    // Для поиска по строке с запятыми, используем ILIKE '%номер%'
    for (const table of TABLES_TO_CHECK) {
        let fields = [];
        switch (table) {
            case "appeals":
            case "appealsotkaz":
            case "dobivashki":
                fields = ["appeal_number", "client_name", "phone", "city", "dialog"];
                break;
            case "dogovornew":
                fields = ["appeal_id", "dogovor_date", "dogovor_number", "city", "client_name", "phone", "total_numbers"];
                break;
            case "eventsnew":
                fields = [
                    "appeal_number", "type", "client_name", "phone", "city", "dialog", "master", "date", "start_time", "end_time"
                ];
                break;
            case "zamerotkaz":
                fields = ["appeal_number", "client_name", "phone", "city", "dialog"];
                break;
            default:
                continue;
        }
        // форматируем как стандартный номер для поиска
        const searchNumber = phone.trim();
        const { data, error } = await supabase
            .from(table)
            .select(fields.join(","))
            .ilike('phone', `%${searchNumber}%`)
            .limit(1);
        if (error) continue;
        if (data && data.length > 0) {
            // дополнительно проверяем по каждому номеру из ячейки
            const clearSearch = searchNumber.replace(/\D/g, '');
            const foundRow = data.find(row => {
                return row.phone &&
                    row.phone
                        .split(/[,\.]/)
                        .map(p => p.replace(/\s/g, '').replace(/\D/g, ''))
                        .some(num => num === clearSearch);
            });
            if (foundRow) {
                return { table, info: foundRow };
            }
        }
    }
    return null;
}

// === НОВАЯ ФУНКЦИЯ: Создание итогового сообщения ===
function createFinalCallMessage(callData, foundInfo, duration, createdAppealId) {
    const { formattedFromNumber, lineName, managers, acceptedManager } = callData;
    
    let finalMsg = `📞 <b>ЗАВЕРШЕННЫЙ ЗВОНОК</b>\n`;
    finalMsg += `Абонент: <b>${formattedFromNumber}</b>\n`;
    finalMsg += `${lineName}\n`;
    
    // Показываем всех менеджеров, кому звонили
    if (managers && managers.length > 0) {
        if (managers.length === 1) {
            finalMsg += `Звонок менеджеру: <b>${managers[0]}</b>\n`;
        } else {
            finalMsg += `Дозвон: <b>${managers.join(' → ')}</b>\n`;
        }
    }
    
    // Показываем кто принял
    if (acceptedManager) {
        finalMsg += `Принял: <b>${acceptedManager}</b> (${formatDuration(duration)})\n\n`;
    } else {
        finalMsg += `Не принят (${formatDuration(duration)})\n\n`;
    }
    
    if (foundInfo) {
        const sectionName = TABLE_NAMES[foundInfo.table] || foundInfo.table;
        finalMsg += `📋 <b>Найдено в базе: ${sectionName}</b>\n`;
        
        switch (foundInfo.table) {
            case "appeals":
            case "appealsotkaz":
            case "dobivashki":
            case "zamerotkaz":
                finalMsg += `Номер: <b>${foundInfo.info.appeal_number}</b>\n`;
                finalMsg += `Клиент: <b>${foundInfo.info.client_name || ""}</b>\n`;
                finalMsg += `Город: <b>${foundInfo.info.city || ""}</b>\n`;
                if (foundInfo.info.dialog) finalMsg += `Диалог: <i>${foundInfo.info.dialog}</i>\n`;
                break;
            case "dogovornew":
                finalMsg += `ID обращения: <b>${foundInfo.info.appeal_id}</b>\n`;
                finalMsg += `Номер договора: <b>${foundInfo.info.dogovor_number || ""}</b>\n`;
                finalMsg += `Дата договора: <b>${foundInfo.info.dogovor_date || ""}</b>\n`;
                finalMsg += `Клиент: <b>${foundInfo.info.client_name || ""}</b>\n`;
                finalMsg += `Город: <b>${foundInfo.info.city || ""}</b>\n`;
                if (foundInfo.info.total_numbers) finalMsg += `Изделий: <b>${foundInfo.info.total_numbers}</b>\n`;
                break;
            case "eventsnew":
                finalMsg += `Номер: <b>${foundInfo.info.appeal_number}</b>\n`;
                finalMsg += `Тип: <b>${foundInfo.info.type || ""}</b>\n`;
                finalMsg += `Клиент: <b>${foundInfo.info.client_name || ""}</b>\n`;
                finalMsg += `Город: <b>${foundInfo.info.city || ""}</b>\n`;
                finalMsg += `Мастер: <b>${foundInfo.info.master || ""}</b>\n`;
                finalMsg += `Дата: <b>${foundInfo.info.date || ""}</b>\n`;
                finalMsg += `Время: <b>${foundInfo.info.start_time || ""}-${foundInfo.info.end_time || ""}</b>\n`;
                if (foundInfo.info.dialog) finalMsg += `Диалог: <i>${foundInfo.info.dialog}</i>\n`;
                break;
            case "contractsfinalnew":
                finalMsg += `ID обращения: <b>${foundInfo.info.appeal_id}</b>\n`;
                finalMsg += `Номер договора: <b>${foundInfo.info.dogovor_number || ""}</b>\n`;
                finalMsg += `Дата договора: <b>${foundInfo.info.dogovor_date || ""}</b>\n`;
                finalMsg += `Клиент: <b>${foundInfo.info.client_name || ""}</b>\n`;
                finalMsg += `Город: <b>${foundInfo.info.city || ""}</b>\n`;
                if (foundInfo.info.total_numbers) finalMsg += `Изделий: <b>${foundInfo.info.total_numbers}</b>\n`;
                break;
            default:
                finalMsg += "(нет данных)\n";
        }
    } else {
        finalMsg += `📋 <b>Создана новая заявка</b>\n`;
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
            // Удаляем предыдущие сообщения
            try {
                if (messageData.incomingMessageId) {
                    await telegramBot.deleteMessage(TELEGRAM_CHAT_ID, messageData.incomingMessageId);
                }
                if (messageData.foundMessageId) {
                    await telegramBot.deleteMessage(TELEGRAM_CHAT_ID, messageData.foundMessageId);
                }
                if (messageData.connectedMessageId) {
                    await telegramBot.deleteMessage(TELEGRAM_CHAT_ID, messageData.connectedMessageId);
                }
                // Удаляем все сообщения о дозвонах
                if (messageData.dialoutMessageIds && messageData.dialoutMessageIds.length > 0) {
                    for (const msgId of messageData.dialoutMessageIds) {
                        await telegramBot.deleteMessage(TELEGRAM_CHAT_ID, msgId);
                    }
                }
            } catch (e) {
                console.log("Ошибка при удалении сообщений:", e.message);
            }
            
            // Создаем итоговое сообщение
            const finalMessage = createFinalCallMessage(messageData.callData, messageData.foundInfo, duration, messageData.createdAppealId);
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
        let msg = `📞 <b>ВХОДЯЩИЙ ЗВОНОК</b>\nАбонент: <b>${formattedFromNumber}</b>\n${lineName}\nЗвонок менеджеру: ${formattedToNumber} (${managerName})\n\n🔍 Проверка в базе...`;
        const incomingMessage = await telegramBot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: "HTML" });
        
        // === ИНИЦИАЛИЗИРУЕМ ДАННЫЕ В ПАМЯТИ ===
        callMessages[formattedFromNumber] = {
            incomingMessageId: incomingMessage.message_id,
            foundMessageId: null,
            connectedMessageId: null,
            dialoutMessageIds: [],
            foundInfo: null,
            createdAppealId: null,
            callData: {
                formattedFromNumber,
                lineName,
                managers: [managerName],
                acceptedManager: null
            }
        };

        // === ПОИСК СНАЧАЛА В contractsfinalnew.json ===
        const foundContract = findContractByPhoneFromFile(formattedFromNumber);
        if (foundContract) {
            // Шаблон для файла
            let replyMsg = `ℹ️ <b>${TABLE_NAMES['contractsfinalnew']}</b>\n`;
            replyMsg +=
                `ID обращения: <b>${foundContract.appeal_id}</b>\n` +
                `Номер договора: <b>${foundContract.dogovor_number || ""}</b>\n` +
                `Дата договора: <b>${foundContract.dogovor_date || ""}</b>\n` +
                `Клиент: <b>${foundContract.client_name || ""}</b>\n` +
                `Город: <b>${foundContract.city || ""}</b>\n` +
                `Телефон: <b>${foundContract.phone || ""}</b>\n` +
                (foundContract.total_numbers ? `Изделий: <b>${foundContract.total_numbers}</b>\n` : '');
            
            const foundMessage = await telegramBot.sendMessage(TELEGRAM_CHAT_ID, replyMsg, { parse_mode: "HTML" });
            
            // === СОХРАНЯЕМ ДАННЫЕ О НАЙДЕННОЙ ИНФОРМАЦИИ ===
            callMessages[formattedFromNumber].foundMessageId = foundMessage.message_id;
            callMessages[formattedFromNumber].foundInfo = {
                table: 'contractsfinalnew',
                info: foundContract
            };
            
            return reply.send({ status: "appeared_processed", source: "contractsfinalnew.json" });
        }

        // === Если НЕ найден — ищем в Supabase ===
        const found = await findClientInfoByPhone(formattedFromNumber);
        if (found) {
            const sectionName = TABLE_NAMES[found.table] || found.table;
            let replyMsg = `ℹ️ <b>${sectionName}</b>\n`;
            switch (found.table) {
                case "appeals":
                case "appealsotkaz":
                case "dobivashki":
                case "zamerotkaz":
                    replyMsg +=
                        `Номер: <b>${found.info.appeal_number}</b>\n` +
                        `Клиент: <b>${found.info.client_name || ""}</b>\n` +
                        `Город: <b>${found.info.city || ""}</b>\n` +
                        (found.info.dialog ? `Диалог: <i>${found.info.dialog}</i>\n` : '');
                    break;
                case "dogovornew":
                    replyMsg +=
                        `ID обращения: <b>${found.info.appeal_id}</b>\n` +
                        `Номер договора: <b>${found.info.dogovor_number || ""}</b>\n` +
                        `Дата договора: <b>${found.info.dogovor_date || ""}</b>\n` +
                        `Клиент: <b>${found.info.client_name || ""}</b>\n` +
                        `Город: <b>${found.info.city || ""}</b>\n` +
                        `Телефон: <b>${found.info.phone || ""}</b>\n` +
                        (found.info.total_numbers ? `Изделий: <b>${found.info.total_numbers}</b>\n` : '');
                    break;
                case "eventsnew":
                    replyMsg +=
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
                    replyMsg += "(нет данных)\n";
            }
            
            const foundMessage = await telegramBot.sendMessage(TELEGRAM_CHAT_ID, replyMsg, { parse_mode: "HTML" });
            
            // === СОХРАНЯЕМ ДАННЫЕ О НАЙДЕННОЙ ИНФОРМАЦИИ ===
            callMessages[formattedFromNumber].foundMessageId = foundMessage.message_id;
            callMessages[formattedFromNumber].foundInfo = found;
            
        } else {
            // ЛОГИКА создания новой заявки (оставь как есть)
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
                
                // === СОХРАНЯЕМ ID СООБЩЕНИЯ ОБ ОШИБКЕ ===
                callMessages[formattedFromNumber].foundMessageId = errorMessage.message_id;
                
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
                
                // === СОХРАНЯЕМ ID СООБЩЕНИЯ О СОЗДАНИИ ЗАЯВКИ И НОМЕР ЗАЯВКИ ===
                callMessages[formattedFromNumber].foundMessageId = successMessage.message_id;
                callMessages[formattedFromNumber].createdAppealId = appeal_id;
                
            } catch (e) {
                const errorMessage = await telegramBot.sendMessage(
                    TELEGRAM_CHAT_ID,
                    `❌ <b>Ошибка создания заявки</b>\n${formattedFromNumber}\n${e.message}`,
                    { parse_mode: "HTML" }
                );
                
                // === СОХРАНЯЕМ ID СООБЩЕНИЯ ОБ ОШИБКЕ ===
                callMessages[formattedFromNumber].foundMessageId = errorMessage.message_id;
                
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
