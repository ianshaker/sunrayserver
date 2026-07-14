// ============================================================================
// Текст Telegram-карточек для отдела событий.
// ============================================================================

/**
 * Полная карточка клиента (заявка / обновление).
 *
 * @param {object} p
 * @param {string} p.header — первая строка (шапка)
 * @param {string|null|undefined} [p.masterName] — если есть, добавляем мастер/дату/время
 */
function buildClientCard({
  appealNumber,
  clientName,
  phone,
  city,
  address,
  detailedAddress,
  dialog,
  masterName,
  formattedDate,
  formattedTime,
  header,
}) {
  let msg = `${header}\n----------------------\n`;
  msg += `Клиент: ${clientName || ""} ${phone || ""}\n`;
  msg += city ? `Город: ${city}\n` : "";
  msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
  msg += detailedAddress ? `Детальный: ${detailedAddress}\n` : "";
  msg += dialog ? `Диалог: ${dialog}\n` : "";
  msg += "---------------------\n";
  if (masterName) {
    msg += `Мастер: ${masterName}\n`;
    msg += formattedDate ? `Дата: ${formattedDate}\n` : "";
    msg += formattedTime ? `Время: ${formattedTime}\n` : "";
  }
  return msg;
}

/**
 * Короткое сообщение об отмене старому мастеру при переназначении.
 */
function buildCancelMessage({
  labels,
  appealNumber,
  city,
  address,
  formattedDate,
  formattedTime,
  footer = "Переназначен другому мастеру.",
}) {
  let msg = `❌ ${labels.cancelTitle}\n${labels.cancelNoun} ${appealNumber || ""}\n`;
  msg += city ? `Город: ${city}\n` : "";
  msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
  msg += formattedDate ? `Дата: ${formattedDate}\n` : "";
  msg += formattedTime ? `Время: ${formattedTime}\n` : "";
  msg += footer;
  return msg;
}

module.exports = {
  buildClientCard,
  buildCancelMessage,
};
