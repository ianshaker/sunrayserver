/** Строки/ссылки Bitrix-формы — не показываем в Telegram. */
const SKIP_LINE_PATTERNS = [
  /Ссылка для просмотра результата формы/i,
  /bitrix\/admin\/iblock_element_edit/i,
  /IBLOCK_ID=/i,
  /type=aspro_priority_form/i,
  /find_section_section=/i,
  /[&?]WF=Y/i,
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shouldSkipLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (SKIP_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if (/^https?:\/\/[^\s]*bitrix[^\s]*$/i.test(trimmed)) {
    return true;
  }

  if (/^https?:\/\/[^\s]*zhalyuzi-sunray\.ru\/bitrix[^\s]*$/i.test(trimmed)) {
    return true;
  }

  return false;
}

/** Сырое тело для Telegram: без Bitrix-ссылок, с лимитом длины. */
function sanitizeEmailBodyForTelegram(emailText) {
  const lines = String(emailText || "").split(/\r?\n/);
  const body = lines
    .filter((line) => !shouldSkipLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const MAX_LENGTH = 2500;
  if (body.length <= MAX_LENGTH) return body;
  return `${body.slice(0, MAX_LENGTH)}…`;
}

/** Блок под чертой для HTML-сообщения Telegram. */
function formatRawEmailBlockForTelegram(emailText) {
  const body = sanitizeEmailBodyForTelegram(emailText);
  if (!body) return "";

  return (
    "\n─────────────\n" +
    "📄 <b>Текст письма:</b>\n" +
    `<pre>${escapeHtml(body)}</pre>`
  );
}

module.exports = {
  sanitizeEmailBodyForTelegram,
  formatRawEmailBlockForTelegram,
};
