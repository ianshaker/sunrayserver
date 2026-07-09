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
  // dialog/note/client_name/phone/address намеренно не выбираем — по
  // договорённости в ответе только время, тип, ID заявки и город (см. render.js).
  const { data, error } = await supabase
    .from("eventsnew")
    .select("master, date, type, start_time, end_time, city, appeal_number")
    .ilike("master", canonicalMaster)
    .eq("date", date)
    .order("start_time", { ascending: true, nullsFirst: false });

  if (error) {
    console.error("[schedule-ai/queries] getMasterEventsForDate:", error.message);
    throw error;
  }
  return data || [];
}

/**
 * Все события в конкретном городе, начиная с указанной даты (включительно),
 * отсортированные по дате и времени — сырьё для поиска «ближайшего события
 * в городе X» (nearestCity.js). Таблица небольшая (~150 строк) — фильтрация
 * по мастеру/типу делается уже в JS после выборки, без лишних round-trip'ов.
 * @param {string} canonicalCity — точное значение из cityAliases.CITIES
 * @param {string} fromDateStr — "YYYY-MM-DD", включительно
 * @param {string|null} typeFilterResolved — точный тип из eventsnew.type или null
 */
async function getCityEventsFromDate(canonicalCity, fromDateStr, typeFilterResolved = null) {
  let query = supabase
    .from("eventsnew")
    .select("master, date, type, start_time, end_time, city, appeal_number")
    .ilike("city", canonicalCity)
    .gte("date", fromDateStr)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });

  if (typeFilterResolved) {
    query = query.eq("type", typeFilterResolved);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[schedule-ai/queries] getCityEventsFromDate:", error.message);
    throw error;
  }
  return data || [];
}

/**
 * Все события от указанной даты (включительно) во ВСЕХ городах — сырьё для
 * фолбэка «похожий город» (nearestCity.js), когда в искомом городе совпадений
 * нет. Таблица небольшая (~150 строк) — фильтрация по расстоянию (Хаверсин)
 * делается в JS после одной этой выборки, без запроса на каждый город.
 * @param {string} fromDateStr — "YYYY-MM-DD", включительно
 * @param {string|null} typeFilterResolved — точный тип из eventsnew.type или null
 */
async function getUpcomingEvents(fromDateStr, typeFilterResolved = null) {
  let query = supabase
    .from("eventsnew")
    .select("master, date, type, start_time, end_time, city, appeal_number")
    .gte("date", fromDateStr)
    .order("date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });

  if (typeFilterResolved) {
    query = query.eq("type", typeFilterResolved);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[schedule-ai/queries] getUpcomingEvents:", error.message);
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

module.exports = { getMasterEventsForDate, getCityEventsFromDate, getUpcomingEvents, filterByTimeRange };
