// ============================================================================
// yandexmail/imap/guard — защита «только чтение».
//
// Гарантия здесь не на словах: модуль не запустится, если режим чтения снят,
// и не продолжит работу, если сервер открыл папку с правом записи.
// ============================================================================

const fs = require("fs");
const path = require("path");
const { isReadOnly } = require("../config");

/** Команды IMAP и действия, которых в этом модуле быть не должно. */
const FORBIDDEN = [
  "messageDelete",
  "messageMove",
  "messageCopy",
  "messageFlagsAdd",
  "messageFlagsRemove",
  "messageFlagsSet",
  "mailboxCreate",
  "mailboxDelete",
  "mailboxRename",
  "append(",
  "expunge",
  "sendMail",
  "createTransport",
];

class ReadOnlyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "ReadOnlyViolation";
  }
}

/** Вызывается до подключения: снятый режим чтения останавливает модуль. */
function assertReadOnlyModeEnabled() {
  if (!isReadOnly()) {
    throw new ReadOnlyViolation(
      "YANDEX_IMAP_READ_ONLY снят. Модуль чтения почты работает только в режиме чтения " +
        "и намеренно не запускается без него.",
    );
  }
}

/**
 * Вызывается сразу после открытия папки. ImapFlow отдаёт признак того,
 * как папка открыта на самом деле; если сервер дал право записи — уходим.
 * @param {{readOnly?: boolean, path?: string}} mailbox
 */
function assertMailboxOpenedReadOnly(mailbox) {
  if (!mailbox || mailbox.readOnly !== true) {
    throw new ReadOnlyViolation(
      `Папка «${mailbox?.path || "?"}» открыта не в режиме чтения. Работа прервана.`,
    );
  }
}

/**
 * Проверка исходников самого модуля: ни одной команды изменения ящика.
 * Нужна не столько сейчас, сколько через полгода, когда кто-то захочет
 * «на минутку» добавить пометку прочитанного.
 * @returns {{clean: boolean, findings: Array<{file: string, command: string}>}}
 */
function scanModuleForMutations(rootDir = path.join(__dirname, "..")) {
  const findings = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      if (full === __filename) continue; // сам список запретов не считаем находкой

      const source = fs.readFileSync(full, "utf8");
      for (const command of FORBIDDEN) {
        if (source.includes(command)) {
          findings.push({ file: path.relative(rootDir, full), command });
        }
      }
    }
  };

  walk(rootDir);
  return { clean: findings.length === 0, findings };
}

module.exports = {
  FORBIDDEN,
  ReadOnlyViolation,
  assertReadOnlyModeEnabled,
  assertMailboxOpenedReadOnly,
  scanModuleForMutations,
};
