// ============================================================================
// Справочник городов для сервера — единственный вход для всего остального кода.
//
// Источник правды — таблица `cities` в Supabase, та же, что читает CRM. Города
// заводит менеджер сам (CRM: окно «Добавить город»), поэтому списки в коде
// больше не ведутся: здесь только резерв на случай, когда база молчит.
//
// Пользоваться так:
//   const cities = require("../cities");
//   const resolved = await cities.resolveCity("в Можайске");   // → «Можайск»
//   const km = await cities.distanceBetween("Дубна", "Клин");  // → 43.6
//
// Подробности — в README.md рядом.
// ============================================================================

const { getCities, resetCache } = require("./store");
const { resolveCityName, normalize } = require("./matching");
const { distanceBetweenCities, haversineKm } = require("./geo");

/** Названия городов справочника. */
async function cityNames() {
  const cities = await getCities();
  return cities.map((city) => city.name);
}

/** Города по имени — для расстояний и координат. */
async function citiesByName() {
  const cities = await getCities();
  return new Map(cities.map((city) => [city.name, city]));
}

/**
 * Резолюция города из свободного текста в точное название справочника.
 * Понимает падежи, «г.» и мелкие опечатки.
 */
async function resolveCity(rawName) {
  const names = await cityNames();
  return resolveCityName(names, rawName);
}

/** Расстояние между городами справочника, км. null — если координат нет. */
async function distanceBetween(cityA, cityB) {
  const byName = await citiesByName();
  return distanceBetweenCities(byName, cityA, cityB);
}

/** Есть ли у города координаты: у направлений МСК их нет — это не точки. */
async function hasCoordinates(cityName) {
  const byName = await citiesByName();
  const city = byName.get(cityName);
  return Boolean(city && city.lat != null && city.lng != null);
}

module.exports = {
  getCities,
  // Счёт по готовому справочнику: берут, когда расстояний нужно много подряд
  // (перебор событий), чтобы не ждать справочник на каждой строке.
  distanceBetweenCities,
  cityNames,
  citiesByName,
  resolveCity,
  distanceBetween,
  hasCoordinates,
  resetCache,
  normalize,
  haversineKm,
};
