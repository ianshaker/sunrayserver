// ============================================================================
// yandexmail/config — все настройки чтения Яндекс.Почты в одном месте.
//
// Модуль ничего не запускает и никуда не ходит: только читает переменные
// окружения и отвечает на вопросы «включено ли» и «всё ли задано».
//
// Пароль наружу не отдаётся никогда — ни через экспорт, ни в логи.
// ============================================================================

const DEFAULTS = {
  host: "imap.ya.ru",
  port: 993,
  secure: true,
  mailbox: "INBOX",
  pollIntervalMs: 60000,
};

/** Переменная окружения со значением «истина» — только явное "true". */
function flag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

function number(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(name, fallback = "") {
  const raw = process.env[name];
  return raw === undefined ? fallback : String(raw).trim();
}

/** Главный рубильник. При false модуль не подключается к почте вовсе. */
function isEnabled() {
  return flag("YANDEX_IMAP_ENABLED", false);
}

/** Тень: читаем и сверяем, но наружу — ни карточек, ни сообщений. */
function isShadowMode() {
  return flag("YANDEX_IMAP_SHADOW_MODE", true);
}

/** Только чтение. Ставится в true и меняться не должен: см. imap/guard.js. */
function isReadOnly() {
  return flag("YANDEX_IMAP_READ_ONLY", true);
}

function getConnectionConfig() {
  return {
    host: text("YANDEX_IMAP_HOST", DEFAULTS.host),
    port: number("YANDEX_IMAP_PORT", DEFAULTS.port),
    secure: flag("YANDEX_IMAP_SECURE", DEFAULTS.secure),
    user: text("YANDEX_IMAP_USER"),
    password: text("YANDEX_IMAP_PASSWORD"),
    mailbox: text("YANDEX_IMAP_MAILBOX", DEFAULTS.mailbox),
    pollIntervalMs: number("YANDEX_IMAP_POLL_INTERVAL_MS", DEFAULTS.pollIntervalMs),
  };
}

/**
 * Чего не хватает для подключения. Пустой список — можно пробовать.
 * @returns {string[]} имена незаданных переменных
 */
function listMissingSettings() {
  const config = getConnectionConfig();
  const missing = [];
  if (!config.user) missing.push("YANDEX_IMAP_USER");
  if (!config.password) missing.push("YANDEX_IMAP_PASSWORD");
  if (!config.host) missing.push("YANDEX_IMAP_HOST");
  if (!config.mailbox) missing.push("YANDEX_IMAP_MAILBOX");
  return missing;
}

/** Безопасное описание настроек: адрес показан частично, пароля нет вовсе. */
function describeSettings() {
  const config = getConnectionConfig();
  const [name, domain] = config.user.split("@");
  const maskedUser = config.user
    ? `${(name || "").slice(0, 2)}***@${domain || "?"}`
    : "не задан";

  return {
    enabled: isEnabled(),
    shadowMode: isShadowMode(),
    readOnly: isReadOnly(),
    host: config.host,
    port: config.port,
    secure: config.secure,
    mailbox: config.mailbox,
    user: maskedUser,
    passwordSet: Boolean(config.password),
    pollIntervalMs: config.pollIntervalMs,
    missing: listMissingSettings(),
  };
}

module.exports = {
  DEFAULTS,
  isEnabled,
  isShadowMode,
  isReadOnly,
  getConnectionConfig,
  listMissingSettings,
  describeSettings,
};
