const { supabase } = require("../lib/supabaseClient");
const { TABLES_TO_CHECK, TABLE_NAMES } = require("./constants");

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

module.exports = {
    findAllClientInfoByPhone,
    buildFoundInfoMessage,
};
