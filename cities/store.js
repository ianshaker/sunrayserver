// ============================================================================
// Чтение справочника городов из базы с кэшем в памяти.
//
// Города заводит менеджер прямо в CRM, поэтому список живёт в таблице `cities`,
// а не в коде. Сервер читает её раз в десять минут: справочник меняется от силы
// раз в неделю, а бот расписания отвечает десятки раз в час.
//
// Если база не ответила — берём резерв (fallback.js) и пишем строку в лог.
// Бот должен ответить даже со старым списком: молчание хуже неточности.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { fallbackCities } = require("./fallback");

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = null;
let cachedAt = 0;
let inFlight = null;
let fallbackReported = false;

async function loadFromDatabase() {
  const { data, error } = await supabase
    .from("cities")
    .select("name, lat, lng, direction")
    .order("sort", { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error("справочник пуст");

  return data.map((row) => ({
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    direction: row.direction,
  }));
}

/**
 * Справочник городов. Свежий из кэша, иначе из базы, иначе резерв.
 * @returns {Promise<Array<{name: string, lat: number|null, lng: number|null, direction: string|null}>>}
 */
async function getCities({ force = false } = {}) {
  const fresh = cache && Date.now() - cachedAt < CACHE_TTL_MS;
  if (fresh && !force) return cache;

  // Пока один запрос в пути, остальные ждут его, а не шлют свои.
  if (!inFlight) {
    inFlight = loadFromDatabase()
      .then((cities) => {
        cache = cities;
        cachedAt = Date.now();
        fallbackReported = false;
        return cities;
      })
      .catch((error) => {
        if (!fallbackReported) {
          fallbackReported = true;
          const source = cache ? "на прошлом списке из базы" : "на резерве из кода";
          console.error(
            `[cities] справочник из базы не прочитан (${error.message}) — работаем ${source}`,
          );
        }
        // Отказ тоже запоминаем на те же десять минут: иначе каждый вопрос
        // к боту снова шёл в упавшую базу и ждал таймаут.
        cache = cache || fallbackCities();
        cachedAt = Date.now();
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

module.exports = { getCities };
