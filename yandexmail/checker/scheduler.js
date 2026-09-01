// ============================================================================
// yandexmail/checker/scheduler — расписание проверки почты Яндекса.
//
// Запускается только при включённом рубильнике. Пока YANDEX_IMAP_ENABLED=false,
// не создаётся ни одного таймера и не открывается ни одного соединения:
// ветка Gmail работает так, будто этого модуля нет.
// ============================================================================

const { isEnabled, isShadowMode, isReadOnly, describeSettings, listMissingSettings } = require("../config");
const { assertReadOnlyModeEnabled } = require("../imap/guard");
const { checkOnce } = require("./runCheck");
const { getCounters } = require("./counters");
const { nextDelayMs, isWithinGraceWindow, describeWaiting } = require("../imap/authRetry");

/** Первый проход — не сразу после старта: даём серверу подняться. */
const FIRST_RUN_DELAY_MS = 15000;

/** Как часто писать в лог сводку счётчиков. */
const SUMMARY_EVERY_MS = 60 * 60 * 1000;

let pollTimer = null;
let summaryTimer = null;

/** Пока Яндекс не принял пароль, долбить его каждую минуту незачем и вредно. */
let authFailedSince = 0;
let authAttempt = 0;
let nextAuthTryAt = 0;

function logSummary() {
  const c = getCounters();
  console.log(
    `[yandexmail] за час: проходов ${c.runs}, писем просмотрено ${c.seen}, наших ${c.appeals} — ` +
      `заведено ${c.created}, показано в тесте ${c.wouldCreate}, повторов ${c.duplicate}, ` +
      `из чёрного списка ${c.blacklisted}, без номера ${c.noPhone}, договоров ${c.contract}, ` +
      `ошибок ${c.errors} (подряд ${c.errorsInRow}), пропущено писем ${c.skipped}; ` +
      `последний успешный проход: ${c.lastSuccessAt || "не было"}`,
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
    runGuarded();
  }, FIRST_RUN_DELAY_MS);

  pollTimer = setInterval(runGuarded, settings.pollIntervalMs);
  summaryTimer = setInterval(logSummary, SUMMARY_EVERY_MS);
}

/**
 * Проход с выдержкой на случай, когда Яндекс не принимает пароль. Новый пароль
 * приложения включается до трёх часов, и всё это время попытки будут падать.
 * Частые неудачные входы почтовому сервису не нравятся, поэтому между ними
 * растёт пауза, а в лог идёт спокойная строка вместо потока ошибок.
 */
async function runGuarded() {
  if (nextAuthTryAt && Date.now() < nextAuthTryAt) return;

  try {
    await checkOnce();
    if (authFailedSince) {
      console.log("[yandexmail] пароль принят, работаем в обычном ритме");
    }
    authFailedSince = 0;
    authAttempt = 0;
    nextAuthTryAt = 0;
  } catch (error) {
    if (error?.kind !== "auth") {
      console.error("[yandexmail] проход:", error.message);
      return;
    }

    authFailedSince = authFailedSince || Date.now();
    authAttempt += 1;
    nextAuthTryAt = Date.now() + nextDelayMs(authAttempt);

    if (isWithinGraceWindow(authFailedSince)) {
      console.log(`[yandexmail] ${describeWaiting(authAttempt, authFailedSince)}`);
    } else {
      console.error(
        "[yandexmail] Яндекс не принимает пароль дольше трёх часов — нужен новый пароль приложения",
      );
    }
  }
}

/** Остановить проверку. Нужна для тестов и аккуратного завершения. */
function stopYandexMailChecker() {
  if (pollTimer) clearInterval(pollTimer);
  if (summaryTimer) clearInterval(summaryTimer);
  pollTimer = null;
  summaryTimer = null;
}

module.exports = { startYandexMailChecker, stopYandexMailChecker, logSummary };
