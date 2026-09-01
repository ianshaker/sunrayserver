// ============================================================================
// yandexmail — чтение Яндекс.Почты по IMAP. Только чтение.
//
// Модуль ничего не запускает при подключении: ни таймеров, ни соединений.
// Пока его никто не вызвал — его как будто нет. Это сделано намеренно, чтобы
// появление папки в проекте не могло повлиять на работающую почту через Gmail.
//
// Что умеет:
//   - описать свои настройки, не раскрывая пароль;
//   - подключиться к ящику и открыть папку только на чтение;
//   - принести заголовки писем и, отдельно, письмо целиком;
//   - проверить сам себя и объяснить человеку, что не так.
//
// Чего не умеет и не будет: помечать, перемещать, удалять письма и отправлять
// почту. Таких команд в модуле нет, и это проверяется его же средствами.
// ============================================================================

const config = require("./config");
const { withReadOnlyMailbox, YandexImapError } = require("./imap/client");
const {
  fetchRecentHeaders,
  fetchHeadersAfterUid,
  fetchRawSource,
  readMailboxState,
  normalizeMessageId,
} = require("./imap/fetch");
const {
  scanModuleForMutations,
  assertReadOnlyModeEnabled,
  ReadOnlyViolation,
} = require("./imap/guard");
const authRetry = require("./imap/authRetry");
const { runHealthCheck, formatReport } = require("./health/check");
const { startYandexMailChecker, stopYandexMailChecker } = require("./checker/scheduler");
const { checkOnce, getCounters } = require("./checker/runCheck");
const rules = require("./pipeline/rules");

module.exports = {
  // настройки и состояние
  describeSettings: config.describeSettings,
  isEnabled: config.isEnabled,
  isShadowMode: config.isShadowMode,
  isReadOnly: config.isReadOnly,

  // работа с почтой, всё только на чтение
  withReadOnlyMailbox,
  fetchRecentHeaders,
  fetchHeadersAfterUid,
  fetchRawSource,
  readMailboxState,
  normalizeMessageId,

  // работа по расписанию: при выключенном рубильнике не делает ничего
  startYandexMailChecker,
  stopYandexMailChecker,
  checkOnce,
  getCounters,
  rules,

  // проверки и защита
  runHealthCheck,
  formatReport,
  scanModuleForMutations,
  assertReadOnlyModeEnabled,

  // повторы, пока пароль приложения включается
  authRetry,

  // ошибки
  YandexImapError,
  ReadOnlyViolation,
};
