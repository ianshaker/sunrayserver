// ============================================================================
// yandexmail/imap/authRetry — мягкие повторы, пока пароль приложения «созревает».
//
// Яндекс включает новый пароль приложения не сразу: до двух-трёх часов сервер
// может отвечать отказом. Поэтому первые отказы авторизации — не поломка, а
// ожидание. Тревога поднимается только после того, как окно ожидания вышло.
// ============================================================================

/** Сколько ждём, прежде чем считать отказ авторизации настоящей поломкой. */
const AUTH_GRACE_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Шаги ожидания между попытками: полминуты → минута → ... → четверть часа. */
const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 900_000];

function nextDelayMs(attempt) {
  const index = Math.min(Math.max(attempt, 1), BACKOFF_STEPS_MS.length) - 1;
  return BACKOFF_STEPS_MS[index];
}

/**
 * Ещё ждём или уже бьём тревогу.
 * @param {number} firstFailureAt отметка времени первого отказа
 * @param {number} [now]
 */
function isWithinGraceWindow(firstFailureAt, now = Date.now()) {
  if (!firstFailureAt) return true;
  return now - firstFailureAt < AUTH_GRACE_WINDOW_MS;
}

/** Человеческая строка для лога и для чата — без пароля и без внутренностей. */
function describeWaiting(attempt, firstFailureAt, now = Date.now()) {
  const waitedMin = firstFailureAt ? Math.round((now - firstFailureAt) / 60000) : 0;
  const nextMin = Math.round(nextDelayMs(attempt) / 60000) || 1;
  return (
    `пароль приложения пока не принят (попытка ${attempt}, ждём ${waitedMin} мин), ` +
    `следующая попытка через ${nextMin} мин`
  );
}

module.exports = {
  AUTH_GRACE_WINDOW_MS,
  BACKOFF_STEPS_MS,
  nextDelayMs,
  isWithinGraceWindow,
  describeWaiting,
};
