// ============================================================================
// yandexmail/checker/scheduler — расписание проверки почты Яндекса.
//
// Запускается только при включённом рубильнике. Пока YANDEX_IMAP_ENABLED=false,
// не создаётся ни одного таймера и не открывается ни одного соединения:
// ветка Gmail работает так, будто этого модуля нет.
// ============================================================================

const { isEnabled, isShadowMode, isReadOnly, describeSettings, listMissingSettings } = require("../config");
const { assertReadOnlyModeEnabled } = require("../imap/guard");
const { checkOnce, getCounters } = require("./runCheck");

/** Первый проход — не сразу после старта: даём серверу подняться. */
const FIRST_RUN_DELAY_MS = 15000;

/** Как часто писать в лог сводку счётчиков. */
const SUMMARY_EVERY_MS = 60 * 60 * 1000;

let pollTimer = null;
let summaryTimer = null;

function logSummary() {
  const c = getCounters();
  console.log(
    `[yandexmail] за час: проходов ${c.runs}, писем просмотрено ${c.seen}, наших ${c.appeals} — ` +
      `заведено ${c.created}, показано в тесте ${c.wouldCreate}, повторов ${c.duplicate}, ` +
      `из чёрного списка ${c.blacklisted}, без номера ${c.noPhone}, договоров ${c.contract}, ` +
      `ошибок ${c.errors}; последний успешный проход: ${c.lastSuccessAt || "не было"}`,
  );
}

/**
 * Поднять проверку почты Яндекса. Безопасно вызывать всегда:
 * при выключенном рубильнике просто пишет строку в лог и выходит.
 */
function startYandexMailChecker() {
  const settings = describeSettings();

  if (!isEnabled()) {
    console.log("[yandexmail] выключен (YANDEX_IMAP_ENABLED=false) — почта Яндекса не читается");
    return;
  }

  if (!isReadOnly()) {
    console.error("[yandexmail] НЕ ЗАПУЩЕН: снят режим только чтения. Модуль работает только на чтение.");
    return;
  }

  const missing = listMissingSettings();
  if (missing.length) {
    console.error(`[yandexmail] НЕ ЗАПУЩЕН: не заданы ${missing.join(", ")}`);
    return;
  }

  try {
    assertReadOnlyModeEnabled();
  } catch (error) {
    console.error("[yandexmail] НЕ ЗАПУЩЕН:", error.message);
    return;
  }

  const mode = isShadowMode()
    ? "тест: сообщения в чат с пометкой, карточки НЕ заводятся"
    : "БОЕВОЙ: заявки заводятся так же, как из Gmail";

  console.log(
    `[yandexmail] запущен. Ящик ${settings.user}, папка ${settings.mailbox}, ` +
      `проверка каждые ${Math.round(settings.pollIntervalMs / 1000)} с. Режим — ${mode}.`,
  );

  setTimeout(() => {
    checkOnce().catch((e) => console.error("[yandexmail] первый проход:", e.message));
  }, FIRST_RUN_DELAY_MS);

  pollTimer = setInterval(() => {
    checkOnce().catch((e) => console.error("[yandexmail] проход:", e.message));
  }, settings.pollIntervalMs);

  summaryTimer = setInterval(logSummary, SUMMARY_EVERY_MS);
}

/** Остановить проверку. Нужна для тестов и аккуратного завершения. */
function stopYandexMailChecker() {
  if (pollTimer) clearInterval(pollTimer);
  if (summaryTimer) clearInterval(summaryTimer);
  pollTimer = null;
  summaryTimer = null;
}

module.exports = { startYandexMailChecker, stopYandexMailChecker, logSummary };
