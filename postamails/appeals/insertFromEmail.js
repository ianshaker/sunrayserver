const { notifyIncomingChat } = require("../telegramNotify");
const { findContractByPhoneFromFile } = require("./contractsLocal");
const {
  findExistingAppealByPhone,
  getFreeAppealId,
  markAppealIdUsed,
  insertAppealRecord,
} = require("./supabaseAppeals");
const { extractPhone, extractPhoneRaw } = require("../parsing/phone");
const { extractProduct } = require("../parsing/emailFields");
const { parseAppealFields } = require("../parsing/appealFields");
const {
  buildNewAppealMessage,
  buildDuplicateMessage,
  buildContractMessage,
} = require("./appealMessage");
const {
  escapeHtml,
  formatRawEmailBlockForTelegram,
} = require("../parsing/emailBodyForTelegram");
const { getMskTodayDate } = require("../../appeals-deadlines/queries");
const { APPEAL_SOURCE } = require("../config");
const { collectSpamReasons, formatSpamNotice } = require("./spamSignals");
const { findSpamPhone, registerHit } = require("./spamPhones");

/** Всё, что попадает в HTML-сообщение Telegram: угловая скобка в имени иначе рвёт разметку. */
const esc = (value) => escapeHtml(value || "");

async function insertAppealFromEmail(emailText) {
  // extractPhone уже отдаёт номер в формате базы 8(XXX)XXX-XX-XX либо null.
  const normalizedPhone = extractPhone(emailText);
  const rawPhone = extractPhoneRaw(emailText);

  // Любая заявка с сайта обязана дойти до чата. Номер не разобрали — шлём письмо как есть,
  // карточку не заводим: номер заявки на неё тратить не за что, дубли искать не по чему.
  if (!normalizedPhone) {
    console.log(
      `[postamails] номер не разобран (${rawPhone || "поля нет"}) — письмо ушло в чат текстом`,
    );
    await notifyIncomingChat(
      `📨 <b>ЗАЯВКА С ПОЧТЫ — НОМЕР НЕ РАЗОБРАН</b>\n` +
        `Телефон в письме: <b>${esc(rawPhone || "поля нет")}</b>\n` +
        `Карточка не заведена — звонить по тексту письма.` +
        formatRawEmailBlockForTelegram(emailText),
    );
    return { outcome: "no_phone", phone: null, appealNumber: null };
  }

  // Номер уже забракован человеком — исполняем это решение и дальше не идём.
  // Заявку не заводим и в чат не шлём, но запись в журнале остаётся: след не теряется.
  const blacklisted = await findSpamPhone(normalizedPhone);
  if (blacklisted) {
    await registerHit(blacklisted.phone_digits, blacklisted.hits);
    console.log(
      `[postamails] ${normalizedPhone} в чёрном списке — письмо отбито (попаданий: ${blacklisted.hits + 1})`,
    );
    return { outcome: "blacklisted", phone: normalizedPhone, appealNumber: null };
  }

  // Письмо разбирается один раз: раздел заявки, имя, город, продукт, промокод,
  // почта и текст клиента. Дальше сообщения собираются только из непустых полей.
  const fields = parseAppealFields(emailText);
  const name = fields.name;

  // Признаки рассылки. Ничего не отсекают — только добавляют строку в сообщение.
  const spamReasons = await collectSpamReasons({ rawPhone, normalizedPhone, clientName: name });
  const spamNotice = formatSpamNotice(spamReasons);
  const spamReason = spamReasons.join(", ") || null;

  const contract = findContractByPhoneFromFile(normalizedPhone);
  if (contract) {
    await notifyIncomingChat(buildContractMessage({ contract, fields, spamNotice }));
    return {
      outcome: "contract",
      phone: normalizedPhone,
      appealNumber: contract.appeal_id || null,
      spamReason,
    };
  }

  const existing = await findExistingAppealByPhone(normalizedPhone);
  if (existing) {
    await notifyIncomingChat(
      buildDuplicateMessage({ existing, fields, phone: normalizedPhone, spamNotice }),
    );
    return {
      outcome: "duplicate",
      phone: normalizedPhone,
      appealNumber: existing.info.appeal_id || existing.info.appeal_number || null,
      spamReason,
    };
  }

  // Разбор уже искал город и в полях письма, и в ссылке на форму. Здесь остаётся
  // только значение по умолчанию: карточка без города в CRM выглядит поломанной.
  const city = fields.city || "Без города";
  const product_type = extractProduct(emailText);
  const appeal_id = await getFreeAppealId();
  await markAppealIdUsed(appeal_id);

  const now = new Date().toISOString();
  const appeal = {
    appeal_number: appeal_id,
    client_name: name,
    phone: normalizedPhone,
    city,
    source: APPEAL_SOURCE,
    manager: "Ян",
    dialog: emailText,
    product_type,
    status: "Активно",
    address: "",
    detailed_address: "",
    reminder_date: getMskTodayDate(),
    reminder_time: null,
    task_description: "",
    created_at: now,
    updated_at: now,
  };

  await insertAppealRecord(appeal);

  await notifyIncomingChat(
    buildNewAppealMessage({
      appealNumber: appeal_id,
      fields,
      phone: normalizedPhone,
      spamNotice,
    }),
  );

  return {
    outcome: "created",
    phone: normalizedPhone,
    appealNumber: appeal_id,
    spamReason,
  };
}

module.exports = { insertAppealFromEmail };
