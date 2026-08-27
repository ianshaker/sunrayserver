const { notifyIncomingChat } = require("../telegramNotify");
const { findContractByPhoneFromFile } = require("./contractsLocal");
const {
  findExistingAppealByPhone,
  getFreeAppealId,
  markAppealIdUsed,
  insertAppealRecord,
} = require("./supabaseAppeals");
const { extractPhone, extractPhoneRaw } = require("../parsing/phone");
const {
  extractName,
  extractCity,
  extractProduct,
} = require("../parsing/emailFields");
const {
  escapeHtml,
  formatRawEmailBlockForTelegram,
} = require("../parsing/emailBodyForTelegram");
const { getMskTodayDate } = require("../../appeals-deadlines/queries");
const { APPEAL_SOURCE } = require("../config");
const { collectSpamReasons, formatSpamNotice } = require("./spamSignals");

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

  const name = extractName(emailText);

  // Признаки рассылки. Ничего не отсекают — только добавляют строку в сообщение.
  const spamReasons = await collectSpamReasons({ rawPhone, normalizedPhone, clientName: name });
  const spamNotice = formatSpamNotice(spamReasons);
  const spamReason = spamReasons.join(", ") || null;

  const contract = findContractByPhoneFromFile(normalizedPhone);
  if (contract) {
    await notifyIncomingChat(
      `⛔️ <b>Клиент найден в завершённых договорах</b>\n` +
        `Номер: <b>${esc(contract.appeal_id)}</b>\n` +
        `Клиент: <b>${esc(contract.client_name)}</b>\n` +
        `Телефон: <b>${esc(contract.phone)}</b>\n` +
        `Город: <b>${esc(contract.city)}</b>\n` +
        `Номер договора: <b>${esc(contract.dogovor_number)}</b>` +
        spamNotice +
        formatRawEmailBlockForTelegram(emailText),
    );
    return {
      outcome: "contract",
      phone: normalizedPhone,
      appealNumber: contract.appeal_id || null,
      spamReason,
    };
  }

  const existing = await findExistingAppealByPhone(normalizedPhone);
  if (existing) {
    let msg = `📨 <b>Почтовая заявка с этим номером уже есть в базе</b>\n`;
    msg += `Таблица: <b>${esc(existing.table)}</b>\n`;
    msg += `ID: <b>${esc(existing.info.appeal_id || existing.info.appeal_number)}</b>\n`;
    msg += `Клиент: <b>${esc(existing.info.client_name)}</b>\n`;
    msg += `Телефон: <b>${esc(normalizedPhone)}</b>\n`;
    msg += `Город: <b>${esc(existing.info.city)}</b>\n`;
    msg += `Продукт: <b>${esc(existing.info.product_type)}</b>`;
    msg += spamNotice;
    msg += formatRawEmailBlockForTelegram(emailText);
    await notifyIncomingChat(msg);
    return {
      outcome: "duplicate",
      phone: normalizedPhone,
      appealNumber: existing.info.appeal_id || existing.info.appeal_number || null,
      spamReason,
    };
  }

  const city = extractCity(emailText);
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
    `📨 <b>НОВАЯ ЗАЯВКА С ПОЧТЫ</b>\n` +
      `Номер: <b>${esc(appeal_id)}</b>\n` +
      `Клиент: <b>${esc(name)}</b>\n` +
      `Телефон: <b>${esc(normalizedPhone)}</b>\n` +
      `Город: <b>${esc(city)}</b>\n` +
      `Продукт: <b>${esc(product_type)}</b>` +
      spamNotice +
      formatRawEmailBlockForTelegram(emailText),
  );

  return {
    outcome: "created",
    phone: normalizedPhone,
    appealNumber: appeal_id,
    spamReason,
  };
}

module.exports = { insertAppealFromEmail };
