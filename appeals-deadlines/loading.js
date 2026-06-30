// ============================================================================
// Отправка входящей заявки в погрузку (зеркало CRM handleLoadingSchedule).
// ============================================================================

const { getTelegramBot } = require("../tgwebhook/bot");
const {
  findExistingLoadingEvent,
  insertLoadingEvent,
  deleteAppealById,
} = require("./queries");
const { updateManagerRecords } = require("./loadingManager");

const LOADING_CHAT_ID = -1002669673493;

function cleanAppealNumber(appealNumber) {
  return String(appealNumber || "").replace(/^#+/, "#");
}

function cleanAddressForTelegram(address) {
  return String(address || "")
    .replace(/\(PlaceID:.*?\)/, "")
    .trim();
}

/**
 * @param {object} snapshot — merged appeal fields
 * @param {string|null} salemanager
 */
function buildLoadingEventRow(snapshot, salemanager) {
  return {
    appeal_number: cleanAppealNumber(snapshot.appeal_number),
    type: "Погрузка",
    client_name: snapshot.client_name || "Без имени",
    phone: snapshot.phone || null,
    city: snapshot.city || null,
    address: snapshot.address || null,
    detailed_address: snapshot.detailed_address || null,
    dialog: snapshot.dialog || null,
    master: null,
    date: null,
    start_time: null,
    end_time: null,
    salemanager: salemanager || null,
  };
}

async function notifyLoadingTelegram(snapshot) {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[appeals-deadlines/loading] Telegram bot недоступен — пропуск уведомления");
    return false;
  }

  const appealNumber = cleanAppealNumber(snapshot.appeal_number);
  const clientName = snapshot.client_name || "Без имени";
  const phone = snapshot.phone || "";
  const city = snapshot.city || "";
  const address = cleanAddressForTelegram(snapshot.address);
  const detailedAddress = snapshot.detailed_address || "";
  const dialog = snapshot.dialog || "";

  let msg = `ЗАЯВКА НА ПОГРУЗКУ ${appealNumber}\n----------------------\n`;
  msg += `Клиент: ${clientName} ${phone}\n`;
  if (city) msg += `Город: ${city}\n`;
  if (address) msg += `Адрес: (технический адрес скрыт)\n`;
  if (detailedAddress) msg += `Детальный: ${detailedAddress}\n`;
  if (dialog) msg += `Диалог: ${dialog}\n`;
  msg += "---------------------\n";

  await bot.sendMessage(LOADING_CHAT_ID, msg);
  console.log(`[appeals-deadlines/loading] TG → chat ${LOADING_CHAT_ID} ${appealNumber}`);
  return true;
}

/**
 * Полный флоу погрузки после подтверждения превью.
 *
 * @param {object} appeal — строка appeals (с product_type)
 * @param {object} snapshot — итоговые поля для eventsnew
 * @param {string} salemanager
 * @returns {Promise<{ telegramSent: boolean }>}
 */
async function executeAppealLoading(appeal, snapshot, salemanager) {
  const appealNumber = cleanAppealNumber(snapshot.appeal_number || appeal.appeal_number);

  const existing = await findExistingLoadingEvent(appealNumber);
  if (existing) {
    const err = new Error("already_in_loading");
    err.appealNumber = appealNumber;
    throw err;
  }

  const eventRow = buildLoadingEventRow(snapshot, salemanager);
  await insertLoadingEvent(eventRow);

  let telegramSent = false;
  try {
    telegramSent = await notifyLoadingTelegram(snapshot);
  } catch (err) {
    console.error("[appeals-deadlines/loading] TG ошибка:", err.message);
  }

  await updateManagerRecords(salemanager, appealNumber, appeal);
  await deleteAppealById(appeal.id);

  console.log(`[appeals-deadlines/loading] ✅ ${appealNumber} → eventsnew, appeals удалена`);
  return { telegramSent };
}

module.exports = {
  cleanAppealNumber,
  buildLoadingEventRow,
  executeAppealLoading,
};
