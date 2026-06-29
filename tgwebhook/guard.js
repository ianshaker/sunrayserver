// Проверки доступа: секрет входящего вебхука + ключ страницы управления.

const crypto = require("crypto");
const {
  WEBHOOK_SECRET,
  SETUP_SECRET,
  PUBLIC_BASE_URL,
} = require("./config");

function safeEqual(a, b) {
  const ba = Buffer.from(String(a == null ? "" : a));
  const bb = Buffer.from(String(b == null ? "" : b));
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) {
    return false;
  }
}

/** Telegram возвращает наш секрет в этом заголовке при каждом апдейте. */
function validateTelegramSecret(request) {
  const header = request.headers["x-telegram-bot-api-secret-token"];
  return safeEqual(header, WEBHOOK_SECRET);
}

function extractSetupKey(request) {
  return (
    request.query?.key ||
    request.body?.key ||
    request.headers["x-telegram-setup-key"] ||
    ""
  );
}

function isSetupKeyValid(key) {
  // Без секрета страница открыта (внутреннее использование по ссылке).
  if (!SETUP_SECRET) return true;
  return safeEqual(key, SETUP_SECRET);
}

/** Возвращает true, если доступ заблокирован (ответ уже отправлен). */
function guardSetupAccess(request, reply) {
  if (!isSetupKeyValid(extractSetupKey(request))) {
    reply.code(403).type("text/html").send("<h1>403 Forbidden</h1>");
    return true;
  }
  return false;
}

function appendSetupKey(path, key) {
  const url = `${PUBLIC_BASE_URL}${path}`;
  if (!key) return url;
  return `${url}?key=${encodeURIComponent(key)}`;
}

module.exports = {
  validateTelegramSecret,
  extractSetupKey,
  isSetupKeyValid,
  guardSetupAccess,
  appendSetupKey,
};
