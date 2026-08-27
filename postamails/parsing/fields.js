// ============================================================================
// Единый разбор письма в набор полей.
//
// Письмо от форм сайта — это строки вида «Ключ: значение». Разбираем их один раз,
// по началу строки: поиск подстрокой ловит не то. Например «Сообщение сгенерировано
// автоматически» в подвале письма — не поле «Сообщение».
// ============================================================================

/** Ключ поля: начало строки, до двоеточия, не длиннее 40 знаков. */
const FIELD_LINE = /^\s*([^:]{1,40}?)\s*:\s*(.*)$/;

/**
 * @param {string} text тело письма
 * @returns {Record<string, string>} ключи в нижнем регистре, первое вхождение выигрывает
 */
function parseEmailFields(text) {
  const fields = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(FIELD_LINE);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (key && !(key in fields)) fields[key] = match[2].trim();
  }
  return fields;
}

/** Первое непустое значение из перечисленных ключей. */
function pickField(fields, ...keys) {
  for (const key of keys) {
    const value = fields[key];
    if (value) return value;
  }
  return "";
}

module.exports = { parseEmailFields, pickField };
