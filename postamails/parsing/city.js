// ============================================================================
// postamails/parsing/city — город заявки, даже когда поля «Город» в письме нет.
//
// Формы Битрикса поля с городом не присылают, зато в письме есть ссылка на
// результат формы, а в ней — региональный поддомен сайта:
// `https://schelkovo.zhalyuzi-sunray.ru/...` — значит человек пришёл из Щёлкова.
//
// Замер по живому ящику за 90 дней: из 52 писем таких форм город достаётся из
// ссылки у 49. Это как раз содержательные заявки — расчёт стоимости, проект,
// вопрос, — где город раньше терялся совсем.
//
// Словарь собран по реально встреченным поддоменам. Написание не угадывается:
// незнакомый поддомен даёт пустой город и строку в лог, чтобы дописать словарь.
// ============================================================================

/** Поддомен сайта → город. Только то, что реально приходило в письмах. */
const CITY_BY_SUBDOMAIN = {
  balashikha: "Балашиха",
  bronnitcy: "Бронницы",
  chekhov: "Чехов",
  dolgoprudnyi: "Долгопрудный",
  ivanteevka: "Ивантеевка",
  kashira: "Кашира",
  khimki: "Химки",
  kolomna: "Коломна",
  korolev: "Королёв",
  krasnogorsk: "Красногорск",
  luhovitcy: "Луховицы",
  lyublino: "Люблино",
  mytischi: "Мытищи",
  "naro-fominsk": "Наро-Фоминск",
  noginsk: "Ногинск",
  obninsk: "Обнинск",
  odintsovo: "Одинцово",
  "orehovo-zuevo": "Орехово-Зуево",
  "pavlovskii-posad": "Павловский Посад",
  pushkino: "Пушкино",
  ramenskoe: "Раменское",
  schelkovo: "Щёлково",
  "sergiev-posad": "Сергиев Посад",
  serpukhov: "Серпухов",
  sochi: "Сочи",
  strogino: "Строгино",
  volokolamsk: "Волоколамск",
  zelenograd: "Зеленоград",
  zheleznodorozhnyi: "Железнодорожный",
  zhukovskii: "Жуковский",
  zvenigorod: "Звенигород",
};

const SITE_LINK = /https?:\/\/([a-z0-9-]+)\.zhalyuzi-sunray\.ru/i;

/** Уже сообщённые незнакомые поддомены: в лог пишем один раз, а не каждую минуту. */
const reportedUnknown = new Set();

/**
 * Город из ссылки на результат формы.
 * @param {string} emailText тело письма
 * @returns {string} название города или пустая строка
 */
function cityFromLink(emailText) {
  const match = String(emailText || "").match(SITE_LINK);
  if (!match) return "";

  const subdomain = match[1].toLowerCase();
  // Основной сайт без региона — города в ссылке нет, и это нормально.
  if (subdomain === "www") return "";

  const city = CITY_BY_SUBDOMAIN[subdomain];
  if (city) return city;

  if (!reportedUnknown.has(subdomain)) {
    reportedUnknown.add(subdomain);
    console.log(
      `[postamails/город] незнакомый поддомен «${subdomain}» — добавить в словарь postamails/parsing/city.js`,
    );
  }
  return "";
}

/**
 * Город заявки: сначала поле письма, потом ссылка.
 * @param {string} fieldCity значение поля «Город», если оно было
 * @param {string} emailText тело письма
 */
function resolveCity(fieldCity, emailText) {
  const fromField = String(fieldCity || "").trim();
  if (fromField) return fromField;
  return cityFromLink(emailText);
}

module.exports = { CITY_BY_SUBDOMAIN, cityFromLink, resolveCity };
