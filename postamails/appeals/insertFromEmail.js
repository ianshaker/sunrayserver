const { notifyIncomingChat } = require("../telegramNotify");
const { findContractByPhoneFromFile } = require("./contractsLocal");
const {
  findExistingAppealByPhone,
  getFreeAppealId,
  markAppealIdUsed,
  insertAppealRecord,
} = require("./supabaseAppeals");
const { extractPhone, normalizePhone } = require("../parsing/phone");
const {
  extractName,
  extractCity,
  extractProduct,
} = require("../parsing/emailFields");
const { formatRawEmailBlockForTelegram } = require("../parsing/emailBodyForTelegram");
const { getMskTodayDate } = require("../../appeals-deadlines/queries");

async function insertAppealFromEmail(emailText) {
  const phone = extractPhone(emailText);
  if (!phone) throw new Error("Телефон не найден");

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Невалидный номер");

  const contract = findContractByPhoneFromFile(normalizedPhone);
  if (contract) {
    await notifyIncomingChat(
      `⛔️ <b>Клиент найден в завершённых договорах</b>\n` +
        `Номер: <b>${contract.appeal_id || ""}</b>\n` +
        `Клиент: <b>${contract.client_name || ""}</b>\n` +
        `Телефон: <b>${contract.phone || ""}</b>\n` +
        `Город: <b>${contract.city || ""}</b>\n` +
        `Номер договора: <b>${contract.dogovor_number || ""}</b>` +
        formatRawEmailBlockForTelegram(emailText),
    );
    return {
      outcome: "contract",
      phone: normalizedPhone,
      appealNumber: contract.appeal_id || null,
    };
  }

  const existing = await findExistingAppealByPhone(normalizedPhone);
  if (existing) {
    let msg = `📨 <b>Почтовая заявка с этим номером уже есть в базе</b>\n`;
    msg += `Таблица: <b>${existing.table}</b>\n`;
    msg += `ID: <b>${existing.info.appeal_id || existing.info.appeal_number || ""}</b>\n`;
    msg += `Клиент: <b>${existing.info.client_name || ""}</b>\n`;
    msg += `Телефон: <b>${normalizedPhone}</b>\n`;
    msg += `Город: <b>${existing.info.city || ""}</b>\n`;
    msg += `Продукт: <b>${existing.info.product_type || ""}</b>`;
    msg += formatRawEmailBlockForTelegram(emailText);
    await notifyIncomingChat(msg);
    return {
      outcome: "duplicate",
      phone: normalizedPhone,
      appealNumber: existing.info.appeal_id || existing.info.appeal_number || null,
    };
  }

  const name = extractName(emailText);
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
    source: "Почта",
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
      `Номер: <b>${appeal_id}</b>\n` +
      `Клиент: <b>${name}</b>\n` +
      `Телефон: <b>${normalizedPhone}</b>\n` +
      `Город: <b>${city}</b>\n` +
      `Продукт: <b>${product_type}</b>` +
      formatRawEmailBlockForTelegram(emailText),
  );

  return {
    outcome: "created",
    phone: normalizedPhone,
    appealNumber: appeal_id,
  };
}

module.exports = { insertAppealFromEmail };
