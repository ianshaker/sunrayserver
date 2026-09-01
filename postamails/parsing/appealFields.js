// ============================================================================
// postamails/parsing/appealFields — письмо превращается в понятия, а не в строки.
//
// Формы сайта называют одно и то же по-разному: «Ваше имя» и «Имя», «Продукт»,
// «Проект» и «Интересующий товар/услуга». Здесь эти написания сводятся к одному
// понятию, а пустые и мусорные значения выбрасываются сразу — чтобы дальше
// сообщение собиралось только из того, что действительно есть.
//
// Разбор идёт по строкам «Ключ: значение», отдельно достаётся многострочный
// текст клиента из поля «Сообщение».
// ============================================================================

const { parseEmailFields, pickField } = require("./fields");
const { detectFormType } = require("./formTypes");
const { resolveCity } = require("./city");

/** Понятие → как оно называется в письмах разных форм. */
const FIELD_SYNONYMS = {
  name: ["ваше имя", "имя"],
  phone: ["телефон", "ваш телефон", "тел"],
  city: ["город"],
  product: ["продукт", "проект", "интересующий товар/услуга", "товар", "услуга"],
  promo: ["промокод"],
  email: ["e-mail", "email", "почта"],
};

/** Значения, которые формально есть, но смысла не несут. */
const MEANINGLESS = new Set([
  "html",
  "-",
  "--",
  "—",
  "не указан",
  "не указано",
  "нет",
  "null",
  "undefined",
]);

/**
 * Известные имена полей формы. Встретили такую строку внутри «Сообщения» —
 * значит текст клиента кончился и пошли служебные поля. Проверяем именно по
 * списку, а не по любому двоеточию: клиент пишет «Размеры: 150х240», и такую
 * строку терять нельзя.
 */
const KNOWN_FIELD_NAMES = [
  "ваше имя",
  "имя",
  "телефон",
  "ваш телефон",
  "тел",
  "город",
  "продукт",
  "проект",
  "интересующий товар/услуга",
  "товар",
  "услуга",
  "промокод",
  "e-mail",
  "email",
  "почта",
  "ссылка для просмотра результата формы",
];

function isFieldLine(line) {
  const match = String(line).match(/^\s*([^:]{1,40}?)\s*:/);
  if (!match) return false;
  return KNOWN_FIELD_NAMES.includes(match[1].trim().toLowerCase());
}

/** Строки-подвалы: после них текст клиента заканчивается. */
const FOOTER_MARKERS = [
  /^ссылка для просмотра результата формы\s*:/i,
  /^сообщение сгенерировано автоматически/i,
  /^-{5,}$/,
];

function clean(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (MEANINGLESS.has(text.toLowerCase())) return "";
  return text;
}

/**
 * Текст клиента из поля «Сообщение»: он многострочный и заканчивается подвалом
 * письма. Обычный разбор «ключ: значение» берёт только первую строку, поэтому
 * здесь отдельный проход.
 *
 * @param {string} emailText
 * @returns {string} текст без служебных строк, либо пусто
 */
function extractClientMessage(emailText) {
  const lines = String(emailText || "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*сообщение\s*:/i.test(line));
  if (start === -1) return "";

  const collected = [];

  // Однострочный случай: «Сообщение: текст в той же строке».
  const inline = lines[start].replace(/^\s*сообщение\s*:\s*/i, "").trim();
  if (inline) collected.push(inline);

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (FOOTER_MARKERS.some((marker) => marker.test(line))) break;
    // Пошли служебные поля формы — значит текст клиента закончился.
    if (isFieldLine(line)) break;
    collected.push(line);
  }

  return clean(collected.join("\n").replace(/\n{3,}/g, "\n\n").trim());
}

/**
 * Разобрать письмо в понятия.
 *
 * @param {string} emailText тело письма
 * @returns {{
 *   form: {key: string, label: string},
 *   name: string, phone: string, city: string,
 *   product: string, promo: string, email: string, message: string
 * }}
 */
function parseAppealFields(emailText) {
  const fields = parseEmailFields(emailText);
  const form = detectFormType(emailText);

  const byConcept = {};
  for (const [concept, keys] of Object.entries(FIELD_SYNONYMS)) {
    byConcept[concept] = clean(pickField(fields, ...keys));
  }

  return {
    form: { key: form.key, label: form.label },
    ...byConcept,
    // Города может не быть в полях — тогда он берётся из ссылки на форму.
    city: resolveCity(byConcept.city, emailText),
    message: extractClientMessage(emailText),
  };
}

module.exports = {
  FIELD_SYNONYMS,
  KNOWN_FIELD_NAMES,
  MEANINGLESS,
  isFieldLine,
  clean,
  extractClientMessage,
  parseAppealFields,
};
