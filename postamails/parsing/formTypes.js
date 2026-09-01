// ============================================================================
// postamails/parsing/formTypes — какая форма сайта прислала письмо.
//
// Первая строка письма всегда называет форму: «Новое сообщение формы "Обратный
// звонок с промокодом" с сайта…» или «Заполнена заявка на замер». Из неё берётся
// раздел заявки — короткое имя, которое идёт первой строкой сообщения в чат.
//
// Список собран по живому ящику за 60 дней (2560 писем с сайта, семь форм):
// PLANS/SERVER/01-pochta/format-zayavok/00-analitika-form.md
//
// Восьмая форма появится — попадёт в «Заявка с сайта» и будет разобрана по общим
// правилам. Ничего не теряется: неизвестная форма это повод дописать строку сюда,
// а не причина потерять заявку.
// ============================================================================

/**
 * Формы в порядке проверки. Первое совпадение выигрывает, поэтому длинные и
 * частные названия стоят раньше коротких: «Заказать бесплатный замер» должен
 * сработать раньше, чем «Замер».
 *
 * @typedef {{key: string, label: string, match: RegExp, hasMessage: boolean}} FormType
 */
const FORM_TYPES = [
  {
    key: "promo_call",
    label: "Обратный звонок · промокод",
    match: /обратный\s+звонок\s+с\s+промокодом/i,
    hasMessage: false,
  },
  {
    key: "measure_request",
    label: "Заявка на замер",
    match: /заполнена\s+заявка\s+на\s+замер/i,
    hasMessage: true,
  },
  {
    key: "free_calc",
    label: "Расчёт стоимости",
    match: /заказать\s+бесплатный\s+расч[её]т/i,
    hasMessage: true,
  },
  {
    key: "free_measure",
    label: "Замер",
    match: /заказать\s+бесплатный\s+замер/i,
    hasMessage: true,
  },
  {
    key: "free_call",
    label: "Обратный звонок",
    match: /бесплатный\s+обратный\s+звонок/i,
    hasMessage: false,
  },
  {
    key: "question",
    label: "Вопрос",
    match: /задать\s+вопрос/i,
    hasMessage: true,
  },
  {
    key: "project",
    label: "Проект",
    match: /заказать\s+проект/i,
    hasMessage: true,
  },
];

/** Форма, о которой мы ещё не знаем: разбираем как умеем, ничего не выбрасываем. */
const UNKNOWN_FORM = {
  key: "unknown",
  label: "Заявка с сайта",
  match: null,
  hasMessage: true,
};

/**
 * Узнать форму по тексту письма. Смотрим только начало: название формы стоит
 * в первой строке, а дальше идут поля и текст клиента, где те же слова могут
 * встретиться случайно.
 *
 * @param {string} emailText тело письма
 * @returns {FormType} найденная форма или UNKNOWN_FORM
 */
function detectFormType(emailText) {
  const head = String(emailText || "")
    .split(/\r?\n/)
    .slice(0, 3)
    .join(" ");

  return FORM_TYPES.find((form) => form.match.test(head)) || UNKNOWN_FORM;
}

/** Раздел заявки для сообщения в чат. */
function formLabel(emailText) {
  return detectFormType(emailText).label;
}

/** Опознана ли форма. Нужно там, где к неизвестным письмам отношение особое. */
function isKnownForm(emailText) {
  return detectFormType(emailText).key !== UNKNOWN_FORM.key;
}

module.exports = { FORM_TYPES, UNKNOWN_FORM, detectFormType, formLabel, isKnownForm };
