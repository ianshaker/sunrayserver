// ============================================================================
// lib/mskTime — московское время в одном месте.
//
// Сервер живёт по UTC, а люди и заявки — по Москве. Раньше это пересчитывалось
// в каждом модуле по-своему, поэтому здесь один набор функций на всех.
// ============================================================================

const MSK_OFFSET_HOURS = 3;
const TIMEZONE = "Europe/Moscow";

/** Московский час от 0 до 23. */
function mskHour(now = new Date()) {
  return (now.getUTCHours() + MSK_OFFSET_HOURS) % 24;
}

/** Префикс для лога: «[метка 12:07 МСК]». */
function mskLogPrefix(tag, now = new Date()) {
  const hour = String(mskHour(now)).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  return `[${tag} ${hour}:${minute} МСК]`;
}

/** Дата и время для человека: «01.09.2026, 12:11». */
function formatMskDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "время неизвестно";
  return date.toLocaleString("ru-RU", {
    timeZone: TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Дата по Москве «YYYY-MM-DD» для момента (по умолчанию — сейчас); null, если момент не разобрать. */
function mskDate(value = new Date()) {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + MSK_OFFSET_HOURS * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Время по Москве «HH:mm» для момента (по умолчанию — сейчас). */
function mskClock(value = new Date()) {
  return new Date(new Date(value).getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000)
    .toISOString()
    .slice(11, 16);
}

/** Рабочее ли сейчас время по Москве. */
function isWorkTime(from = 9, to = 21, now = new Date()) {
  const hour = mskHour(now);
  return hour >= from && hour < to;
}

module.exports = {
  MSK_OFFSET_HOURS,
  TIMEZONE,
  mskHour,
  mskDate,
  mskClock,
  mskLogPrefix,
  formatMskDateTime,
  isWorkTime,
};
