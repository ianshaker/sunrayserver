// ============================================================================
// Время для задач из Telegram. Менеджеры всегда говорят по Москве (UTC+3),
// в БД (manager_tasks.due_date — timestamptz) храним UTC ISO.
// ============================================================================

const MSK_OFFSET = "+03:00";
const TIMEZONE = "Europe/Moscow";

/** Части текущего московского времени (через Intl, без зависимостей). */
function nowMskParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  ); // { year, month, day, hour, minute, second }
}

/** Строка «2026-06-29T19:27:00 (понедельник)» для промпта парсера. */
function nowMskString() {
  const p = nowMskParts();
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    timeZone: TIMEZONE,
    weekday: "long",
  }).format(new Date());
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second} (${weekday})`;
}

/** "2026-06-30T10:00:00" (локальное МСК) → Date в UTC. */
function mskLocalToDate(localStr) {
  if (!localStr) return null;
  const normalized = String(localStr).trim().replace(" ", "T");
  const date = new Date(`${normalized}${MSK_OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** "2026-06-30T10:00:00" (локальное МСК) → UTC ISO для БД. */
function mskLocalToUtcIso(localStr) {
  const date = mskLocalToDate(localStr);
  return date ? date.toISOString() : null;
}

/** UTC ISO → «30 июня 2026, 10:00 МСК» для ответа в чат. */
function formatMskHuman(utcIso) {
  if (!utcIso) return "не указано";
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return "не указано";

  const human = date.toLocaleString("ru-RU", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${human} МСК`;
}

module.exports = {
  MSK_OFFSET,
  TIMEZONE,
  nowMskParts,
  nowMskString,
  mskLocalToDate,
  mskLocalToUtcIso,
  formatMskHuman,
};
