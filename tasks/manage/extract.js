// ============================================================================
// Детерминированный разбор простых команд переноса: «задачу 19 … 21:03».
// Обходит Gemini, когда номер задачи и время HH:MM однозначны.
// ============================================================================

const { nowMskParts } = require("../create/time");

const RESCHEDULE_HINT =
  /(?:перенес|перенест|перенос|сдвин|сдвиг|измени\s+время|новое\s+время|дедлайн|на\s+друг)/i;

/** «задачу 19», «задача #19», «#19» — номер после слова «задач*» или после #. */
const TASK_NUMBER =
  /(?:задач[ауеё]|задачу)\s*#?\s*(\d{1,6})\b|#\s*(\d{1,6})\b/i;

/** Явное время HH:MM (не путаем с номером задачи — ищем после ключевых слов времени). */
const TIME_AFTER_HINT =
  /(?:^|[\s,])(?:в|на|к|до|дедлайн)\s*(\d{1,2}):(\d{2})(?:\s|$|[.,])/i;

const TIME_BARE = /\b(\d{1,2}):(\d{2})\b/g;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function extractTaskNumber(text) {
  const m = text.match(TASK_NUMBER);
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function extractTime(text, taskNumber) {
  // Предпочитаем «в 21:03», «на 21:03», «дедлайн 21:03»
  const hinted = text.match(TIME_AFTER_HINT);
  if (hinted) {
    const hour = Number(hinted[1]);
    const minute = Number(hinted[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // Fallback: единственное HH:MM в тексте, не равное номеру задачи как «19:00»
  const all = [...text.matchAll(TIME_BARE)];
  for (const m of all) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    // «19:00» при task 19 — пропускаем, если нет явного «в/на»
    if (taskNumber != null && hour === taskNumber && minute === 0) continue;
    return { hour, minute };
  }
  return null;
}

/**
 * @returns {{ action: "reschedule", taskNumber: number, dueDateMskLocal: string } | null}
 */
function tryExtractReschedule(text) {
  if (!text || !text.trim()) return null;
  if (!RESCHEDULE_HINT.test(text)) return null;

  const taskNumber = extractTaskNumber(text);
  if (taskNumber == null) return null;

  const time = extractTime(text, taskNumber);
  if (!time) return null;

  const p = nowMskParts();
  const dueDateMskLocal = `${p.year}-${p.month}-${p.day}T${pad2(time.hour)}:${pad2(time.minute)}:00`;

  return { action: "reschedule", taskNumber, dueDateMskLocal };
}

module.exports = { tryExtractReschedule };
