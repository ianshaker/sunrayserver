// ============================================================================
// Запросы к eventsnew для отдела «Расписание AI».
// Только чтение. Никакая часть этого файла не проходит через LLM —
// это единственный источник фактов, которые увидит менеджер.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");

/**
 * События конкретного мастера на конкретную дату (регистронезависимо по master).
 * @param {string} canonicalMaster
 * @param {string} date — "YYYY-MM-DD"
 */
async function getMasterEventsForDate(canonicalMaster, date) {
  // dialog/note намеренно не выбираем — это внутренние заметки, а не факты
  // для расписания, и они раздувают ответ менеджеру (см. обсуждение).
  const { data, error } = await supabase
    .from("eventsnew")
    .select("id, master, date, type, start_time, end_time, client_name, phone, city, address, appeal_number")
    .ilike("master", canonicalMaster)
    .eq("date", date)
    .order("start_time", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("[schedule-ai/queries] getMasterEventsForDate:", error.message);
    throw error;
  }
  return data || [];
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Фильтрация уже полученных событий по пересечению с [timeFrom, timeTo].
 * Точечный запрос ("в 13:00") — timeFrom === timeTo, берём события, чей
 * интервал [start,end) включает эту минуту (или начинается точно в неё).
 */
function filterByTimeRange(events, timeFrom, timeTo) {
  const from = timeToMinutes(timeFrom);
  const to = timeToMinutes(timeTo);
  if (from == null || to == null) return events;

  return events.filter((ev) => {
    const evStart = timeToMinutes(ev.start_time);
    const evEnd = timeToMinutes(ev.end_time);
    if (evStart == null) return false;
    const effectiveEnd = evEnd != null ? evEnd : evStart + 1;
    // пересечение интервалов [evStart,effectiveEnd) и [from, to] (to включительно, чтобы точка попадала)
    return evStart <= to && effectiveEnd > from;
  });
}

module.exports = { getMasterEventsForDate, filterByTimeRange };
