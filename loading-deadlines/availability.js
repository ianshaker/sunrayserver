// ============================================================================
// Проверка пересечения слотов мастера — зеркало CRM masterAvailabilityCheck.ts.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");

/**
 * @param {string} start1 HH:mm
 * @param {string} end1
 * @param {string} start2
 * @param {string} end2
 */
function timeOverlap(start1, end1, start2, end2) {
  return start1 < end2 && end1 > start2;
}

/**
 * Нормализует время к HH:mm (обрезает секунды).
 * @param {string} t
 */
function normalizeTime(t) {
  const s = String(t || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * @param {{ master: string, date: string, startTime: string, endTime: string, excludeEventId?: number }} slot
 * @returns {Promise<{
 *   hasConflict: boolean,
 *   conflictingEvent?: object,
 *   errorMessage?: string,
 * }>}
 */
async function checkMasterAvailability(slot) {
  const master = slot.master;
  const date = slot.date;
  const startTime = normalizeTime(slot.startTime);
  const endTime = normalizeTime(slot.endTime);

  try {
    const { data: existingEvents, error } = await supabase
      .from("eventsnew")
      .select("id, type, appeal_number, start_time, end_time")
      .eq("master", master)
      .eq("date", date)
      .not("start_time", "is", null)
      .not("end_time", "is", null);

    if (error) {
      console.error("[loading-deadlines/availability]", error.message);
      return {
        hasConflict: true,
        errorMessage: `Ошибка проверки доступности: ${error.message}`,
      };
    }

    for (const event of existingEvents || []) {
      if (slot.excludeEventId != null && event.id === slot.excludeEventId) continue;

      const evStart = normalizeTime(event.start_time);
      const evEnd = normalizeTime(event.end_time);
      if (timeOverlap(startTime, endTime, evStart, evEnd)) {
        return {
          hasConflict: true,
          conflictingEvent: event,
          errorMessage:
            `Мастер ${master} уже занят ${evStart}–${evEnd} ` +
            `(${event.type} ${event.appeal_number}). Выберите другое время или другого мастера.`,
        };
      }
    }

    return { hasConflict: false };
  } catch (err) {
    console.error("[loading-deadlines/availability] critical:", err.message);
    return {
      hasConflict: true,
      errorMessage: `Ошибка проверки слота: ${err.message}`,
    };
  }
}

module.exports = { checkMasterAvailability, timeOverlap, normalizeTime };
