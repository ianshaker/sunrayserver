// ============================================================================
// yandexmail — чтение Яндекс.Почты по IMAP. Только чтение.
//
// Модуль ничего не запускает при подключении: ни таймеров, ни соединений.
// Пока его никто не вызвал — его как будто нет. Это сделано намеренно, чтобы
// появление папки в проекте не могло повлиять на работающую почту.
//
// Что умеет:
//   - читать почту по расписанию и заводить заявки тем же кодом, что Gmail;
//   - следить за тишиной и будить человека, если почту никто не читает;
//   - проверять сам себя и объяснять, что не так.
//
// Чего не умеет и не будет: помечать, перемещать, удалять письма и отправлять
// почту. Таких команд в модуле нет, и это проверяется его же средствами.
//
// Наружу отдаётся только то, что реально нужно серверу и ручной проверке.
// Внутренние части (выборка писем, закладка, правила отбора) берутся напрямую
// из своих файлов — так видно, кто чем пользуется.
// ============================================================================

const { describeSettings, isEnabled, isShadowMode, isReadOnly } = require("./config");
const { startYandexMailChecker, stopYandexMailChecker } = require("./checker/scheduler");
const { startMailWatchdog, stopMailWatchdog } = require("./checker/watchdog");
const { getCounters } = require("./checker/counters");
const { runHealthCheck, formatReport } = require("./health/check");
const { YandexImapError } = require("./imap/client");
const { ReadOnlyViolation } = require("./imap/guard");

module.exports = {
  // настройки и состояние
  describeSettings,
  isEnabled,
  isShadowMode,
  isReadOnly,
  getCounters,

  // работа: при выключенном рубильнике проверка почты не запускается,
  // а сторож работает всегда — выключенный источник тоже повод разбудить
  startYandexMailChecker,
  stopYandexMailChecker,
  startMailWatchdog,
  stopMailWatchdog,

  // ручная проверка
  runHealthCheck,
  formatReport,

  // ошибки
  YandexImapError,
  ReadOnlyViolation,
};
