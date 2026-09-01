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

/** Рабочее ли сейчас время по Москве. */
function isWorkTime(from = 9, to = 21, now = new Date()) {
  const hour = mskHour(now);
  return hour >= from && hour < to;
}

module.exports = { MSK_OFFSET_HOURS, TIMEZONE, mskHour, mskLogPrefix, formatMskDateTime, isWorkTime };
