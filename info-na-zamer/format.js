// ============================================================================
// Форматирование даты/времени для TG-карточек событий.
// ============================================================================

const WEEKDAYS_RU = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

function formatDate(dateString) {
  if (!dateString) return "";

  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    d = new Date(dateString + "T00:00:00");
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split(".");
    d = new Date(`${year}-${month}-${day}T00:00:00`);
  } else {
    d = new Date(dateString);
  }
  if (isNaN(d)) return dateString;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const weekday = WEEKDAYS_RU[d.getDay()];
  return `${day}.${month}.${year} (${weekday})`;
}

function formatTime(t) {
  if (!t) return "";
  const parts = t.split(":");
  return `${parts[0] || "00"}.${parts[1] || "00"}`;
}

function formatTimeRange(start, end) {
  if (!start && !end) return "";
  return `${formatTime(start)}${end ? "-" + formatTime(end) : ""}`;
}

// Координаты в CRM — как их копирует Яндекс и как их пропускает проверка колонки coordinates в базе.
const COORDINATES_RE = /^(-?\d{1,2}\.\d{6}), (-?\d{1,3}\.\d{6})$/;

/**
 * Ссылка мастеру на точку в Яндекс Картах. В базе «широта, долгота» (55.753960, 37.620393),
 * а в `pt` Яндекс ждёт долготу первой — переставляем. Обычная ссылка, не API: бесплатно, без ключа.
 * Нет координат или формат чужой — null, строки «Карта» в сообщении не будет.
 */
function yandexMapsLink(coordinates) {
  const m = COORDINATES_RE.exec(String(coordinates || "").trim());
  if (!m) return null;
  const [, lat, lng] = m;
  return `https://yandex.ru/maps/?pt=${lng},${lat}&z=17&l=map`;
}

module.exports = {
  formatDate,
  formatTime,
  formatTimeRange,
  yandexMapsLink,
};
