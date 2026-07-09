// ============================================================================
// Поиск «ближайшего события в городе X» — ветка query_type: "nearest_city".
//
// Всё, кроме двух строк текста (cityRaw, typeFilterRaw — как назвал менеджер),
// делает код: резолюция города по whitelist (cityAliases), резолюция мастера
// по whitelist (masterAliases), сам SQL, группировка результатов. LLM здесь
// вообще не участвует — это отдельная гарантия точности для новой ветки,
// которую ещё не проверяли в бою (см. commentary.js — для full_day/time_point
// комментарий Gemini уже есть, для nearest_city пока сознательно нет).
// ============================================================================

const { MAX_NEAREST_GROUPS, MAX_NEARBY_RADIUS_KM } = require("./config");
const { resolveCityName } = require("./cityAliases");
const { resolveMasterName } = require("./masterAliases");
const { getCityEventsFromDate, getUpcomingEvents, getMasterEventsForDate } = require("./queries");
const { distanceBetweenCities, hasCoordinates } = require("./cityCoordinates");
const { nowMskParts } = require("../tasks/create/time");

// Типы событий как они реально хранятся в eventsnew.type (см. .cursor/rules).
const KNOWN_TYPES = ["Замер", "Монтаж", "Рекламация", "Выходной", "Погрузка"];

function resolveTypeFilter(raw) {
  if (!raw) return null;
  const norm = String(raw).trim().toLowerCase();
  return KNOWN_TYPES.find((t) => t.toLowerCase() === norm) || null;
}

function todayMskDateStr() {
  const p = nowMskParts();
  return `${p.year}-${p.month}-${p.day}`;
}

/** Ключ строки для сопоставления «это то самое совпадение» между двумя выборками одного дня. */
function buildRowMatchKey(row) {
  return `${row.start_time || ""}|${row.end_time || ""}|${row.appeal_number || ""}`;
}

function normalizeForCompare(s) {
  return String(s || "").trim().toLowerCase().replace(/ё/g, "е");
}

/**
 * Группировка совпавших строк в уникальные пары (мастер, дата), не более
 * MAX_NEAREST_GROUPS, с подгрузкой ПОЛНОГО дня мастера (не только совпавшие
 * строки) — менеджер должен видеть контекст: чем ещё занят день.
 * @param {object[]} matchedRows — строки-совпадения, УЖЕ отсортированные в
 *   нужном приоритете (для exact — по дате; для nearby — по расстоянию, затем дате)
 * @param {(row: object) => { city: string, distanceKm: number|null }} [rowMeta]
 */
async function buildGroups(matchedRows, rowMeta = null) {
  const groupOrder = [];
  const seenKeys = new Set();
  for (const row of matchedRows) {
    const key = `${row.master}__${row.date}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      const meta = rowMeta ? rowMeta(row) : null;
      groupOrder.push({ key, master: row.master, date: row.date, meta });
      if (groupOrder.length >= MAX_NEAREST_GROUPS) break;
    }
  }

  // Собираем ВСЕ совпавшие строки для отобранных групп (не только первую —
  // у одного мастера может быть 2 подходящих события в один день).
  const matchKeysByGroup = new Map(groupOrder.map((g) => [g.key, new Set()]));
  for (const row of matchedRows) {
    const key = `${row.master}__${row.date}`;
    if (matchKeysByGroup.has(key)) {
      matchKeysByGroup.get(key).add(buildRowMatchKey(row));
    }
  }

  return Promise.all(
    groupOrder.map(async (g) => {
      const events = await getMasterEventsForDate(g.master, g.date);
      return {
        master: g.master,
        date: g.date,
        events,
        matchKeys: matchKeysByGroup.get(g.key),
        matchedCity: g.meta?.city ?? null,
        distanceKm: g.meta?.distanceKm ?? null,
      };
    }),
  );
}

/**
 * @param {{ cityRaw: string, mastersRaw: string[], typeFilterRaw: string|null }} params
 * @returns {Promise<
 *   | { status: "city_not_found", cityRaw: string }
 *   | { status: "masters_not_found", mastersRaw: string[] }
 *   | { status: "no_matches", cityCanonical: string, typeFilterResolved: string|null, nearbyChecked: boolean }
 *   | { status: "ok", cityCanonical: string, typeFilterResolved: string|null, masterWarnings: object[], groups: object[] }
 *   | { status: "ok_nearby", cityCanonical: string, typeFilterResolved: string|null, masterWarnings: object[], groups: object[] }
 * >}
 */
async function findNearestCitySchedule({ cityRaw, mastersRaw, typeFilterRaw }) {
  const cityResolved = resolveCityName(cityRaw);
  if (!cityResolved.found) {
    return { status: "city_not_found", cityRaw };
  }

  // Мастер необязателен для этой ветки — пустой список = «любой мастер».
  const mastersResolved = (mastersRaw || []).map((raw) => resolveMasterName(raw));
  const mastersFound = mastersResolved.filter((m) => m.found);
  if (mastersRaw?.length && !mastersFound.length) {
    return { status: "masters_not_found", mastersRaw };
  }
  const mastersCanonicalSet = new Set(mastersFound.map((m) => normalizeForCompare(m.canonical)));
  const masterWarnings = mastersFound.filter((m) => m.assumed);

  const typeFilterResolved = resolveTypeFilter(typeFilterRaw);
  const fromDate = todayMskDateStr();

  // Шаг 1: точное совпадение по искомому городу (как раньше).
  const exactRows = await getCityEventsFromDate(cityResolved.canonical, fromDate, typeFilterResolved);
  const exactFiltered = mastersCanonicalSet.size
    ? exactRows.filter((r) => mastersCanonicalSet.has(normalizeForCompare(r.master)))
    : exactRows;

  if (exactFiltered.length) {
    const groups = await buildGroups(exactFiltered);
    return { status: "ok", cityCanonical: cityResolved.canonical, typeFilterResolved, masterWarnings, groups };
  }

  // Шаг 2: точных совпадений нет — ищем в соседних городах по прямому
  // расстоянию (Хаверсин, без API). Честно: если у искомого города нет
  // координат (агрегированные направления МСК) — фолбэк невозможен, не гадаем.
  if (!hasCoordinates(cityResolved.canonical)) {
    return { status: "no_matches", cityCanonical: cityResolved.canonical, typeFilterResolved, nearbyChecked: false };
  }

  const allRows = await getUpcomingEvents(fromDate, typeFilterResolved);
  const nearbyCandidates = [];
  for (const row of allRows) {
    if (!row.city) continue;
    if (mastersCanonicalSet.size && !mastersCanonicalSet.has(normalizeForCompare(row.master))) continue;
    const dist = distanceBetweenCities(cityResolved.canonical, row.city);
    if (dist == null || dist <= 0 || dist > MAX_NEARBY_RADIUS_KM) continue; // dist<=0 — тот же город, там уже пусто
    nearbyCandidates.push({ ...row, __distanceKm: dist });
  }

  if (!nearbyCandidates.length) {
    return { status: "no_matches", cityCanonical: cityResolved.canonical, typeFilterResolved, nearbyChecked: true };
  }

  // Приоритет: сначала ближе по расстоянию, при равном расстоянии — раньше по дате.
  nearbyCandidates.sort((a, b) => a.__distanceKm - b.__distanceKm || a.date.localeCompare(b.date));

  const groups = await buildGroups(nearbyCandidates, (row) => ({
    city: row.city,
    distanceKm: row.__distanceKm,
  }));

  return {
    status: "ok_nearby",
    cityCanonical: cityResolved.canonical,
    typeFilterResolved,
    masterWarnings,
    groups,
  };
}

module.exports = { findNearestCitySchedule, buildRowMatchKey, resolveTypeFilter };
