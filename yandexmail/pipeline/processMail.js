// ============================================================================
// yandexmail/pipeline/processMail — показ письма в чате для тестового режима.
//
// Работает только когда YANDEX_IMAP_SHADOW_MODE=true. В боевом режиме письмо
// уходит в общую обработку (insertAppealFromEmail), и этот файл не участвует.
//
// Здесь письмо разбирается тем же кодом, что и в ветке Gmail, но карточка не
// заводится и номер заявки не тратится: тест ничего не меняет в CRM.
//
// В чат уходит всё, что стало бы заявкой, — и новое, и то, что уже заведено.
// Так сделано намеренно: при двух работающих источниках второй всегда видел бы
// «повтор» и молчал, а тест потерял бы смысл. Молча отсекается только рассылка
// из чёрного списка и письма без номера — иначе чат утонет.
// ============================================================================

const { simpleParser } = require("mailparser");
const { extractPhone, extractPhoneRaw } = require("../../postamails/parsing/phone");
const {
  extractName,
  extractCity,
  extractProduct,
} = require("../../postamails/parsing/emailFields");
const {
  escapeHtml,
  formatRawEmailBlockForTelegram,
} = require("../../postamails/parsing/emailBodyForTelegram");
const { findSpamPhone } = require("../../postamails/appeals/spamPhones");
const { findExistingAppealByPhone } = require("../../postamails/appeals/supabaseAppeals");
const { notifyIncomingChat } = require("../../postamails/telegramNotify");
const { formatMskDateTime } = require("../../lib/mskTime");

const esc = (value) => escapeHtml(value || "");

/** Пометка, по которой Ян отличает сообщения нового источника от обычных. */
const TEST_MARK = "🧪 <b>ЯНДЕКС · ТЕСТ НОВОГО ИСТОЧНИКА</b>";

/** Сырое письмо → текст, как его видит разбор в ветке Gmail. */
async function extractText(rawSource) {
  const parsed = await simpleParser(rawSource);
  return parsed.text || parsed.html || "";
}

/**
 * Разобрать письмо и, если это новая заявка, показать её в чате.
 * Карточку не заводит и в базу ничего не пишет.
 *
 * @param {Buffer} rawSource письмо целиком
 * @param {{uid: number, from: string, date: any}} header
 * @returns {Promise<{outcome: string, phone: string|null}>}
 */
async function processAppealMail(rawSource, header) {
  const text = await extractText(rawSource);
  const normalizedPhone = extractPhone(text);
  const rawPhone = extractPhoneRaw(text);

  if (!normalizedPhone) {
    return { outcome: "no_phone", phone: rawPhone || null };
  }

  const blacklisted = await findSpamPhone(normalizedPhone);
  if (blacklisted) {
    return { outcome: "blacklisted", phone: normalizedPhone };
  }

  const existing = await findExistingAppealByPhone(normalizedPhone);

  const name = extractName(text);
  const city = extractCity(text);
  const product = extractProduct(text);

  const verdict = existing
    ? `Gmail эту заявку уже завёл — <b>${esc(existing.info?.appeal_id || existing.info?.appeal_number || "номер не показан")}</b>`
    : "Заявка новая: Gmail её пока не заводил";

  await notifyIncomingChat(
    `${TEST_MARK}\n` +
      `Письмо найдено напрямую в почте Яндекса. Карточка НЕ заведена — её заводит Gmail.\n` +
      `${verdict}\n\n` +
      `Клиент: <b>${esc(name)}</b>\n` +
      `Телефон: <b>${esc(normalizedPhone)}</b>\n` +
      `Город: <b>${esc(city)}</b>\n` +
      `Продукт: <b>${esc(product)}</b>\n` +
      `Письмо от ${esc(formatMskDateTime(header.date))}` +
      formatRawEmailBlockForTelegram(text),
  );

  return { outcome: existing ? "seen_duplicate" : "would_create", phone: normalizedPhone };
}

module.exports = { TEST_MARK, extractText, processAppealMail };
