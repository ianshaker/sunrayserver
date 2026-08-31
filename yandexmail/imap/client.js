// ============================================================================
// yandexmail/imap/client — подключение к Яндекс.Почте строго на чтение.
//
// Наружу отдаётся ровно одна дверь: withReadOnlyMailbox(). Она подключается,
// открывает папку командой EXAMINE (доступ только для чтения на уровне
// протокола), отдаёт клиента обработчику и закрывает соединение при любом
// исходе. Методов изменения писем модуль не экспортирует — их некому вызвать.
// ============================================================================

const { ImapFlow } = require("imapflow");
const { getConnectionConfig, listMissingSettings } = require("../config");
const {
  assertReadOnlyModeEnabled,
  assertMailboxOpenedReadOnly,
} = require("./guard");

class YandexImapError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "YandexImapError";
    this.kind = kind; // settings | auth | network | protocol | unknown
  }
}

/** Прячем всё, что похоже на пароль, прежде чем текст попадёт в лог. */
function safeMessage(error, password) {
  let message = String(error?.responseText || error?.message || error || "неизвестная ошибка");
  if (password && password.length > 3) {
    message = message.split(password).join("***");
  }
  return message.slice(0, 300);
}

function classify(error) {
  const code = String(error?.authenticationFailed ? "AUTH" : error?.code || "");
  const text = String(error?.responseText || error?.message || "").toUpperCase();

  if (error?.authenticationFailed || text.includes("AUTHENTICATIONFAILED") || text.includes("LOGIN")) {
    return "auth";
  }
  if (["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(code)) {
    return "network";
  }
  if (text.includes("NO ") || text.includes("BAD ")) return "protocol";
  return "unknown";
}

function buildClient(config) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    // Библиотечный лог выключен намеренно: он печатает команды целиком.
    logger: false,
    emitLogs: false,
    clientInfo: { name: "SunRay server", version: "1.0" },
  });
}

/**
 * Подключиться, открыть папку только на чтение и отдать её обработчику.
 * Соединение закрывается всегда, даже если обработчик упал.
 *
 * @param {(client: import("imapflow").ImapFlow) => Promise<any>} handler
 * @returns {Promise<any>} то, что вернул обработчик
 */
async function withReadOnlyMailbox(handler) {
  assertReadOnlyModeEnabled();

  const missing = listMissingSettings();
  if (missing.length) {
    throw new YandexImapError(`не заданы настройки: ${missing.join(", ")}`, "settings");
  }

  const config = getConnectionConfig();
  const client = buildClient(config);
  let lock = null;

  try {
    await client.connect();
    // readOnly: true → библиотека шлёт EXAMINE вместо SELECT.
    lock = await client.getMailboxLock(config.mailbox, { readOnly: true });
    assertMailboxOpenedReadOnly(client.mailbox);

    return await handler(client);
  } catch (error) {
    if (error?.name === "ReadOnlyViolation" || error?.name === "YandexImapError") throw error;
    throw new YandexImapError(safeMessage(error, config.password), classify(error));
  } finally {
    try {
      if (lock) lock.release();
    } catch (_) {
      /* соединение уже закрыто — молчим */
    }
    try {
      await client.logout();
    } catch (_) {
      try {
        client.close();
      } catch (__) {
        /* и здесь молчим: закрытие не должно ломать вызывающего */
      }
    }
  }
}

module.exports = {
  YandexImapError,
  withReadOnlyMailbox,
  safeMessage,
  classify,
};
