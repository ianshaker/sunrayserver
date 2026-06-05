const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const MANGO_DEBUG_LOG = process.env.MANGO_DEBUG_LOG !== "false";
const MANGO_LOG_FILE = path.join(__dirname, "mango_webhook_debug.jsonl");

function classifyMangoEvent(body) {
    if (body.call_state) {
        return `call → ${body.call_state} @ ${body.location || "?"}`;
    }
    if (body.call_direction !== undefined && body.from && body.to) {
        const dir = body.call_direction === 1 ? "входящий" : body.call_direction === 2 ? "исходящий" : body.call_direction;
        return `summary → ${dir}`;
    }
    return "unknown";
}

function redactSecrets(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const copy = { ...obj };
    if (copy.vpbx_api_key) copy.vpbx_api_key = "[скрыт]";
    if (copy.sign) copy.sign = "[скрыт]";
    return copy;
}

function logMangoWebhook(request, rawBody, parsedBody) {
    if (!MANGO_DEBUG_LOG) return;

    const eventType = classifyMangoEvent(parsedBody);
    const time = new Date().toISOString();
    const divider = "═".repeat(72);

    const logEntry = {
        time,
        path: request.url,
        event: eventType,
        call_id: parsedBody.call_id || parsedBody.entry_id || null,
        raw: rawBody,
        parsed: parsedBody,
    };

    console.log(`\n${divider}`);
    console.log(`🍋 MANGO WEBHOOK  ${time}`);
    console.log(`   URL:    ${request.url}`);
    console.log(`   Тип:    ${eventType}`);
    if (logEntry.call_id) console.log(`   call_id: ${logEntry.call_id}`);
    console.log(`${divider}`);
    console.log("📦 RAW (как пришло от Mango):");
    console.log(JSON.stringify(redactSecrets(rawBody), null, 2));
    console.log("📋 PARSED (распарсенный json):");
    console.log(JSON.stringify(redactSecrets(parsedBody), null, 2));
    console.log(`${divider}\n`);

    try {
        fs.appendFileSync(MANGO_LOG_FILE, JSON.stringify(logEntry) + "\n");
    } catch (e) {
        console.log("⚠️ Не удалось записать mango_webhook_debug.jsonl:", e.message);
    }
}

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
    '79789855708': 'Мякинина',
    '79891930450': 'Юля',
    'elena@vpbx400311913.mangosip.ru': 'Настя',
    'elena': 'Настя',
    'svetlanamanager@vpbx400311913.mangosip.ru': 'Света',
    'svetlanamanager': 'Света'
};

const COMPANY_LINES = {
    '79585382001': '☀️ SUNRAY',
    '79852194439': '🔶 DESIGN-SUN',
    '79852196418': '🔵 СЕТКИ'
};

// Полный справочник кодов Mango Office VPBX API (результаты вызовов и команд).
// Источник: документация API Mango / коды завершения вызовов.
// Для входящих: вызывающий = клиент, вызываемый = менеджер.
const DISCONNECT_REASONS = {
    1000: 'действие успешно выполнено',
    1100: 'завершён в нормальном режиме',
    1110: 'трубку положил клиент',
    1111: 'клиент не дождался ответа',
    1120: 'трубку положил менеджер',
    1121: 'занято',
    1122: 'менеджер отклонил звонок',
    1123: 'сигнал «не беспокоить»',
    1124: 'менеджер недоступен',
    1130: 'ограничения для номера менеджера',
    1131: 'номер менеджера недоступен',
    1132: 'номер менеджера не обслуживается',
    1133: 'номер менеджера не существует',
    1134: 'превышено число переадресаций',
    1140: 'вызовы на регион запрещены настройками АТС',
    1150: 'ограничения для номера клиента',
    1151: 'клиент в чёрном списке',
    1152: 'клиент не в белом списке',
    1160: 'дозвон по группе не удался',
    1161: 'удержание запрещено настройками АТС',
    1162: 'очередь удержания заполнена',
    1163: 'истекло время ожидания в очереди',
    1164: 'все операторы недоступны',
    1170: 'завершён по схеме переадресации',
    1171: 'неверно настроена схема переадресации',
    1180: 'завершён командой пользователя',
    1181: 'завершён командой внешней системы',
    1182: 'завершён перехватом на другого оператора',
    1183: 'назначен новый оператор (перевод)',
    1190: 'менеджер неактивен или нерабочее расписание',
    1191: 'менеджер неактивен (снят флаг в ЛК)',
    1192: 'менеджер неактивен по расписанию',
    1200: 'ошибка сессий контакт-центра',
    1201: 'достигнут лимит подключений',
    1202: 'данные сессии не найдены',
    1210: 'сервер КЦ не может принять подключение',
    1211: 'режим обслуживания',
    1212: 'сервер отключён от БД',
    1230: 'сессия КЦ завершена по системным причинам',
    1231: 'перезагрузка сервера КЦ',
    1232: 'сессия завершена администратором',
    1233: 'сессия завершена администратором (рекомендовано восстановление)',
    1234: 'сессия завершена администратором (рекомендован оффлайн)',
    1235: 'сервер отключился от БД (переход в БРТ)',
    1236: 'изменены критичные данные сессии',
    2000: 'ограничение биллинговой системы',
    2100: 'доступ к счёту невозможен',
    2110: 'счёт заблокирован',
    2120: 'счёт закрыт',
    2130: 'счёт не обслуживается (frozen)',
    2140: 'счёт недействителен',
    2200: 'доступ к счёту ограничен',
    2210: 'доступ ограничен периодом использования',
    2211: 'достигнут дневной лимит услуги',
    2212: 'достигнут месячный лимит услуги',
    2220: 'ограничено число одновременных вызовов',
    2230: 'услуга недоступна',
    2240: 'недостаточно средств на счёте',
    2250: 'ограничение на число использований услуги',
    2300: 'направление заблокировано',
    2400: 'ошибка биллинга',
    3000: 'неверный запрос',
    3100: 'переданы неверные параметры команды',
    3101: 'запрос не через POST',
    3102: 'неверная подпись запроса',
    3103: 'отсутствует обязательный параметр',
    3104: 'параметр в неправильном формате',
    3105: 'неверный ключ доступа',
    3200: 'неверно указан номер абонента',
    3300: 'объект не существует',
    3310: 'вызов не найден',
    3320: 'запись разговора не найдена',
    3330: 'номер не найден у АТС или сотрудника',
    3340: 'файл не найден',
    4000: 'действие не может быть выполнено',
    4001: 'команда не поддерживается',
    4002: 'запись слишком короткая, не сохранена',
    4100: 'команду выполнить невозможно по логике АТС',
    4101: 'вызов завершён или не существует',
    4102: 'запись разговора уже идёт',
    4200: 'связаться с абонентом сейчас невозможно',
    4300: 'SMS не удалось отправить',
    4301: 'SMS устарело',
    4391: 'SMS утеряно оператором',
    4392: 'SMS отклонено оператором',
    4393: 'SMS отменено оператором',
    4400: 'не удалось добавить участника в конференцию',
    4401: 'аппаратная ошибка',
    4402: 'сервис недоступен',
    4403: 'недостаточно ресурсов',
    4404: 'превышен лимит участников конференции',
    4405: 'подключение запрещено настройками конференции',
    4500: 'ограничения системы безопасности',
    4501: 'ограничение частоты звонков',
    4502: 'номер в чёрном списке входящих',
    4503: 'превышен максимальный размер файла',
    4504: 'не удалось определить размер файла',
    4505: 'формат файла не разрешён',
    5000: 'ошибка сервера',
    5001: 'перезапуск коммутатора (ограничение канала)',
    5002: 'перезапуск коммутатора по команде администратора',
    5003: 'технические проблемы коммутатора',
    5004: 'проблемы доступа к БД коммутатора',
    5007: 'ошибка или недоступность внешней системы',
    5101: 'нет продукта контакт-центр',
    5102: 'превышен лимит активных кампаний',
    5103: 'указанный сотрудник не существует',
    5105: 'неподходящий статус кампании',
    5106: 'не удалось вставить задания кампании',
    5107: 'превышен лимит заданий кампании (10 000)',
    5212: 'нет активных номеров',
    6000: 'доставка факса не выполнялась',
    6010: 'технические проблемы сервиса факсов',
    6011: 'номер факса недоступен в течение часа',
    6012: 'номер факса не существует',
    6013: 'на номере не установлен факс-аппарат',
    6014: 'адресат отказался принимать факс',
    6100: 'ошибка при преобразовании факса',
    6101: 'превышен размер файла факса (10 МБ)',
    6102: 'превышено число страниц факса (30)',
};

const activeCalls = {}; // call_id: инфо о звонке
const entryCallMeta = {}; // entry_id: данные с этапа IVR (номер линии до дозвона)

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
    const digits = String(phone).replace(/\D/g, '');
    if (COMPANY_LINES[digits]) return `Линия сайта ${COMPANY_LINES[digits]}`;
    if (COMPANY_LINES[phone]) return `Линия сайта ${COMPANY_LINES[phone]}`;
    return `Линия ${formatPhoneNumber(phone)}`;
}

function resolveLineNumber(body, fallbackEntryId) {
    const fromIvr = fallbackEntryId && entryCallMeta[fallbackEntryId]?.lineNumber;
    return body.line_number
        || body.to?.line_number
        || body.from?.line_number
        || fromIvr
        || body.to?.number;
}

function getDisconnectLabel(code) {
    if (!code) return null;
    const n = Number(code);
    if (DISCONNECT_REASONS[n]) return DISCONNECT_REASONS[n];
    // Mango: подкод наследует описание класса (2219 → 2210, 1090 → 1000)
    const classCode = Math.floor(n / 10) * 10;
    if (DISCONNECT_REASONS[classCode]) return DISCONNECT_REASONS[classCode];
    const majorCode = Math.floor(n / 100) * 100;
    if (DISCONNECT_REASONS[majorCode]) return DISCONNECT_REASONS[majorCode];
    return `неизвестный код ${code}`;
}

function buildCallTiming(summary) {
    const create = summary.create_time || 0;
    const forward = summary.forward_time || 0;
    const talk = summary.talk_time || 0;
    const end = summary.end_time || 0;
    const answered = summary.entry_result === 1 && talk > 0;

    return {
        waitSeconds: forward && create ? Math.max(0, forward - create) : 0,
        ringSeconds: talk && forward ? Math.max(0, talk - forward) : 0,
        talkSeconds: talk && end ? Math.max(0, end - talk) : 0,
        totalSeconds: end && create ? Math.max(0, end - create) : 0,
        answered,
        missed: !answered,
    };
}

function getEventTimestamp(body) {
    return body.timestamp || 0;
}

function ensureLegTracking(callData) {
    if (!callData.managerLegs) callData.managerLegs = [];
    if (callData.currentLegIndex === undefined) callData.currentLegIndex = -1;
}

function closeCurrentManagerLeg(callData, endTimestamp, viaConnect = false) {
    ensureLegTracking(callData);
    const leg = callData.managerLegs[callData.currentLegIndex];
    if (!leg || leg.endedAt) return;

    leg.endedAt = endTimestamp;
    if (viaConnect && leg.connectedAt) {
        leg.ringSeconds = Math.max(0, leg.connectedAt - leg.appearedAt);
    } else {
        leg.ringSeconds = Math.max(0, endTimestamp - leg.appearedAt);
    }
}

function startManagerLeg(callData, managerName, timestamp, ivrPrepSeconds = null) {
    ensureLegTracking(callData);
    closeCurrentManagerLeg(callData, timestamp);

    let prepSeconds = 0;
    let prepLabel = 'Обработка АТС';
    const prev = callData.managerLegs[callData.currentLegIndex];

    if (prev?.endedAt) {
        prepSeconds = Math.max(0, timestamp - prev.endedAt);
        prepLabel = 'Переключение';
    } else if (ivrPrepSeconds !== null && ivrPrepSeconds > 0) {
        prepSeconds = ivrPrepSeconds;
        prepLabel = 'Обработка АТС';
    }

    callData.managerLegs.push({
        name: managerName,
        appearedAt: timestamp,
        prepSeconds,
        prepLabel,
        connectedAt: null,
        endedAt: null,
        ringSeconds: null,
        answered: false,
    });
    callData.currentLegIndex = callData.managerLegs.length - 1;
}

function markManagerLegConnected(callData, timestamp) {
    ensureLegTracking(callData);
    const leg = callData.managerLegs[callData.currentLegIndex];
    if (!leg) return;
    leg.connectedAt = timestamp;
    leg.answered = true;
}

function finalizeManagerLegs(callData, endTimestamp) {
    if (!callData.managerLegs?.length) return;
    const ts = endTimestamp || 0;
    if (ts > 0) closeCurrentManagerLeg(callData, ts);
}

function formatManagerLegsBlock(managerLegs, acceptedManager) {
    if (!managerLegs?.length) return '';

    let block = '\n\n<b>Дозвон по менеджерам</b>';
    managerLegs.forEach((leg, i) => {
        block += `\n${i + 1}. <b>${leg.name}</b>`;
        if (leg.prepSeconds > 0) {
            block += `\n   ${leg.prepLabel}: ${formatDuration(leg.prepSeconds)}`;
        }
        if (leg.answered && acceptedManager === leg.name && leg.ringSeconds > 0) {
            block += `\n   Подняла трубку за: ${formatDuration(leg.ringSeconds)}`;
        } else if (leg.ringSeconds > 0) {
            block += `\n   Не ответила (звонили ${formatDuration(leg.ringSeconds)})`;
        } else if (!leg.answered) {
            block += `\n   Не ответила`;
        }
    });
    return block;
}

function formatCallStatusBlock(callData) {
    const { acceptedManager, timing, disconnectLabel, managerLegs } = callData;
    const hasLegs = managerLegs?.length > 0;
    let block = '';

    if (timing?.answered && acceptedManager) {
        block += `\n<b>Принят</b> — ${acceptedManager}`;
        if (!hasLegs) {
            if (timing.waitSeconds > 0) block += `\nОбработка АТС до звонка менеджеру: ${formatDuration(timing.waitSeconds)}`;
            if (timing.ringSeconds > 0) block += `\nМенеджер поднял трубку за: ${formatDuration(timing.ringSeconds)}`;
        }
        if (timing.talkSeconds > 0) block += `\nРазговор: ${formatDuration(timing.talkSeconds)}`;
        if (timing.totalSeconds > 0) block += `\nВсего: ${formatDuration(timing.totalSeconds)}`;
    } else {
        block += `\n<b>Пропущен</b>`;
        if (!hasLegs) {
            if (timing?.waitSeconds > 0) block += `\nОбработка АТС до звонка менеджеру: ${formatDuration(timing.waitSeconds)}`;
            if (timing?.ringSeconds > 0) block += `\nМенеджер не ответил (звонили ${formatDuration(timing.ringSeconds)})`;
        }
        if (timing?.totalSeconds > 0) block += `\nВсего: ${formatDuration(timing.totalSeconds)}`;
    }

    if (hasLegs) {
        block += formatManagerLegsBlock(managerLegs, acceptedManager);
    }

    if (disconnectLabel) block += `\nЗавершение: <b>${disconnectLabel}</b>`;
    return block;
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

// === Поиск в одной таблице === //
async function searchInTable(table, searchNumber, clearSearch) {
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
            return null;
    }

    const { data, error } = await supabase
        .from(table)
        .select(fields.join(","))
        .ilike('phone', `%${searchNumber}%`)
        .limit(1);

    if (error || !data || data.length === 0) return null;

    const foundRow = data.find(row =>
        row.phone &&
        row.phone
            .split(/[,\.]/)
            .map(p => p.replace(/\s/g, '').replace(/\D/g, ''))
            .some(num => num === clearSearch)
    );

    return foundRow ? { table, info: foundRow } : null;
}

// === Поиск во ВСЕХ таблицах параллельно, возвращает массив всех совпадений === //
async function findAllClientInfoByPhone(phone) {
    const searchNumber = phone.trim();
    const clearSearch = searchNumber.replace(/\D/g, '');

    const rawResults = await Promise.all(
        TABLES_TO_CHECK.map(table => searchInTable(table, searchNumber, clearSearch))
    );

    // фильтруем null и сохраняем оригинальный порядок таблиц
    return rawResults.filter(r => r !== null);
}

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

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

// === Итоговое сообщение (всё собирается сюда) === //
function createFinalCallMessage(callData, foundInfoList, createdAppealId) {
    const { formattedFromNumber, lineName, managers } = callData;

    let finalMsg = `📞 <b>ЗАВЕРШЁННЫЙ ЗВОНОК</b>\n`;
    finalMsg += `Абонент: <b>${formattedFromNumber}</b>\n`;
    finalMsg += `${lineName}\n`;

    if (managers?.length === 1) {
        finalMsg += `Маршрут: <b>${managers[0]}</b>`;
    } else if (managers?.length > 1) {
        finalMsg += `Маршрут: <b>${managers.join(' → ')}</b>`;
    }

    finalMsg += formatCallStatusBlock(callData);

    if (foundInfoList?.length > 0) {
        const n = foundInfoList.length;
        const word = n === 1 ? 'запись' : n < 5 ? 'записи' : 'записей';
        finalMsg += `\n\n📋 <b>История клиента (${n} ${word})</b>\n`;
        for (const found of foundInfoList) {
            finalMsg += `\n` + buildFoundInfoMessage(found);
        }
    } else if (createdAppealId) {
        finalMsg += `\n\n📋 <b>Создана новая заявка</b>\nНомер заявки: <b>${createdAppealId}</b>`;
    } else if (callData.timing?.missed) {
        finalMsg += `\n\n<i>Клиент не найден в базе, заявка не создавалась</i>`;
    }

    return finalMsg;
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
        if (isOutgoingCall(body)) return reply.send({ status: "outgoing_ignored" });

        const fromNumber = body.from?.number;
        const toNumber = body.to?.number;
        const entryId = body.entry_id;
        const lineNumber = resolveLineNumber(body, entryId);
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        const timing = buildCallTiming(body);
        const disconnectLabel = getDisconnectLabel(body.disconnect_reason);
        const managerName = getManagerName(toNumber);

        if (entryId) delete entryCallMeta[entryId];

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

            const finalMessage = createFinalCallMessage(
                callData,
                messageData.foundInfoList,
                messageData.createdAppealId
            );
            await telegramBot.sendMessage(TELEGRAM_CHAT_ID, finalMessage, { parse_mode: "HTML" });
            delete callMessages[formattedFromNumber];
        } else {
            const finalMessage = createFinalCallMessage(callData, [], null);
            await telegramBot.sendMessage(TELEGRAM_CHAT_ID, finalMessage, { parse_mode: "HTML" });
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
            const dialoutMessage = await telegramBot.sendMessage(
                TELEGRAM_CHAT_ID,
                `Дозвон менеджеру ${managerName}`,
                { parse_mode: "HTML" }
            );

            callMessages[formattedFromNumber].dialoutMessageIds.push(dialoutMessage.message_id);
            callMessages[formattedFromNumber].callData.managers.push(managerName);
            startManagerLeg(
                callMessages[formattedFromNumber].callData,
                managerName,
                getEventTimestamp(body)
            );

            return reply.send({ status: "dialout_processed" });
        }

        // === Это новый звонок ===
        if (activeCalls[callId]) return reply.send({ status: "already_appeared" });
        activeCalls[callId] = true;

        const ivrMeta = entryId && entryCallMeta[entryId];
        const lineName = ivrMeta?.lineName || getCompanyLineName(lineNumber);

        const incomingMessage = await telegramBot.sendMessage(
            TELEGRAM_CHAT_ID,
            `📞 <b>ВХОДЯЩИЙ ЗВОНОК</b>\nАбонент: <b>${formattedFromNumber}</b>\n${lineName}\nЗвонок менеджеру: <b>${managerName}</b>`,
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
                acceptedManager: null,
                managerLegs: [],
                currentLegIndex: -1,
            }
        };

        const ts = getEventTimestamp(body);
        const ivrPrep = ivrMeta?.ivrAppearedAt && ts > ivrMeta.ivrAppearedAt
            ? ts - ivrMeta.ivrAppearedAt
            : 0;
        startManagerLeg(callMessages[formattedFromNumber].callData, managerName, ts, ivrPrep);

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
            markManagerLegConnected(
                callMessages[formattedFromNumber].callData,
                getEventTimestamp(body)
            );
            closeCurrentManagerLeg(
                callMessages[formattedFromNumber].callData,
                getEventTimestamp(body),
                true
            );
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

    if (callState === "Disconnected" && location === "abonent" && !isManager(fromNumber)) {
        const formattedFromNumber = formatPhoneNumber(fromNumber);
        if (callMessages[formattedFromNumber]) {
            closeCurrentManagerLeg(
                callMessages[formattedFromNumber].callData,
                getEventTimestamp(body)
            );
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
