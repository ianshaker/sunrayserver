// ============================================================================
// Расстояния между городами по прямой. Раньше жило в
// schedule-ai/cityCoordinates.js вместе с самой таблицей координат; теперь
// координаты приходят из базы, а здесь остался только счёт.
//
// Точность в пределах пары километров — этого достаточно для подсказки
// «ближайший город, где есть события». Это не бизнес-факт про заявку, к нему
// хирургические требования не применяются.
// ============================================================================

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Расстояние по прямой (км) между двумя точками — формула Хаверсина, без API. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Расстояние между двумя городами справочника.
 * null, если у одного из них нет координат — не угадываем.
 * @param {Map<string, {lat: number|null, lng: number|null}>} byName
 */
function distanceBetweenCities(byName, cityA, cityB) {
  const a = byName.get(cityA);
  const b = byName.get(cityB);
  if (!a || !b || a.lat == null || b.lat == null) return null;
  return haversineKm(a.lat, a.lng, b.lat, b.lng);
}

module.exports = { distanceBetweenCities };
