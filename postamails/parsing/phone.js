function formatPhoneClassic(digits) {
  if (!digits) return "";
  digits = digits.replace(/^(\+7|7|8)/, "");
  if (digits.length !== 10) return digits;
  return `8(${digits.substring(0, 3)})${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return formatPhoneClassic(digits);
  if (digits.length === 10) return formatPhoneClassic("8" + digits);
  return phone;
}

/** Строка поля «Телефон:» / «Ваш телефон:» — берём номер из поля, а не любое число письма. */
const PHONE_FIELD_LINE = /^\s*(?:ваш\s+)?тел(?:ефон)?\s*:\s*(.+)$/i;

/** Прежний шаблон «+7 (999) 123-45-67». Остаётся запасным путём, чтобы ничего не потерять. */
const PHONE_PATTERN = /\+7\s*\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}/;

/** Прежний путь: первый номер, похожий на шаблон, где угодно в письме. */
function matchLoosePhone(text) {
  const found = String(text || "").match(PHONE_PATTERN);
  return found ? found[0].trim() : null;
}

/** Как номер записан в письме: «79161192981», «+7 (916) 119-29-81». Нужна для пометки спама. */
function extractPhoneRaw(text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(PHONE_FIELD_LINE);
    if (match) return match[1].trim();
  }
  return matchLoosePhone(text);
}

/** Цифры номера без добавочного: «(495)123-45-67 доб.1234» → «4951234567». */
function phoneDigits(raw) {
  return String(raw || "").split(/доб/i)[0].replace(/\D/g, "");
}

function digitsToClassic(digits) {
  if (digits.length === 11 && /^[78]/.test(digits)) return formatPhoneClassic(digits);
  if (digits.length === 10) return formatPhoneClassic("8" + digits);
  return null;
}

function extractPhone(text) {
  const raw = extractPhoneRaw(text);
  if (raw) {
    const fromField = digitsToClassic(phoneDigits(raw));
    if (fromField) return fromField;
  }

  // Поля нет или номер в нём не сложился — прежний поиск шаблона по всему письму.
  const loose = matchLoosePhone(text);
  if (!loose) return null;
  return formatPhoneClassic(loose.replace(/\D/g, ""));
}

module.exports = {
  formatPhoneClassic,
  normalizePhone,
  extractPhone,
  extractPhoneRaw,
};
