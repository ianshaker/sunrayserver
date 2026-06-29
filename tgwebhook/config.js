// ============================================================================
// tgwebhook — конфигурация переиспользуемого Telegram-вебхука.
//
// Один вебхук на весь сервер. Принимает ВСЕ входящие апдейты Telegram
// (message, callback_query) и раздаёт их через dispatcher любым модулям:
// напоминания (кнопки «Отложить/Готово»), будущие нейронки, любые отделы.
//
// Источник истины:
//   - желаемый URL/секрет — здесь (код, стабильно на всех инстансах);
//   - живой статус вебхука — Telegram (getWebhookInfo);
//   - намерение «включён ли» — Supabase (telegram_webhook_state) для self-heal.
// ============================================================================

const crypto = require("crypto");

/** Токен бота. Лучше задать TELEGRAM_TOKEN в секретах Render. */
const TELEGRAM_TOKEN =
  process.env.TELEGRAM_TOKEN ||
  "7866133715:AAH2lSoDsDnmpQhEjSghjNb23ezp98IZW4g";

/** Публичный адрес сервера (HTTPS обязателен для Telegram-вебхука). */
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://sunrayserver.onrender.com";

/** Куда Telegram шлёт апдейты. */
const WEBHOOK_PATH = "/telegram/webhook";
const WEBHOOK_URL = `${PUBLIC_BASE_URL}${WEBHOOK_PATH}`;

/**
 * Секрет, который Telegram возвращает в заголовке
 * X-Telegram-Bot-Api-Secret-Token при каждом апдейте — так мы проверяем,
 * что запрос реально от Telegram. Стабилен на всех инстансах и переживает
 * рестарты. Можно переопределить TELEGRAM_WEBHOOK_SECRET в env.
 */
function deriveSecret() {
  return crypto
    .createHash("sha256")
    .update(`${TELEGRAM_TOKEN}:sunray-webhook`)
    .digest("hex")
    .slice(0, 48);
}
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || deriveSecret();

/** Страница управления вебхуком (как /gmail/setup). */
const SETUP_PATH = "/telegram/setup";
const ACTIVATE_PATH = "/telegram/setup/activate";
const DELETE_PATH = "/telegram/setup/delete";
const STATUS_PATH = "/telegram/setup/status";

/** Защита страницы управления (?key=). Задай TELEGRAM_SETUP_SECRET в env. */
const SETUP_SECRET = process.env.TELEGRAM_SETUP_SECRET || "";

/** Какие типы апдейтов нам нужны (меньше шума). */
const ALLOWED_UPDATES = ["message", "callback_query"];

/** Лимит одновременных подключений Telegram → наш сервер. */
const MAX_CONNECTIONS = 40;

module.exports = {
  TELEGRAM_TOKEN,
  PUBLIC_BASE_URL,
  WEBHOOK_PATH,
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  SETUP_PATH,
  ACTIVATE_PATH,
  DELETE_PATH,
  STATUS_PATH,
  SETUP_SECRET,
  ALLOWED_UPDATES,
  MAX_CONNECTIONS,
};
