// ============================================================================
// postamails/parsing/clientMessage — текст клиента для сообщения в чат.
//
// Это то, что человек написал сам: размеры, количество окон, пожелания. Раньше
// эти строки были видны только внутри сырого блока письма, и менеджер их не читал.
//
// Замер по ящику за 90 дней: текст встречается у 206 писем из 500, половина
// короче 28 знаков («Заявка со страницы контактов»), самый длинный — 145.
// Полотна редки, но встречаются в проектах и расчётах, поэтому предел стоит
// щедрый: обрезаем только то, что действительно не влезает в сообщение.
// ============================================================================

const { escapeHtml } = require("./emailBodyForTelegram");
const { FOOTER_MARKERS } = require("./appealFields");

/** Предел с запасом: у Telegram на всё сообщение около 4000 знаков. */
const MAX_LENGTH = 1200;

/**
 * Привести текст клиента к виду, годному для чата: без шаблонного мусора,
 * без лесенки пустых строк, с обрезкой по границе строки.
 *
 * @param {string} raw
 * @returns {{text: string, truncated: boolean}}
 */
function normalizeClientMessage(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Шаблонный мусор — те же строки, по которым обрывается разбор письма.
    .filter((line) => !FOOTER_MARKERS.some((marker) => marker.test(line)));

  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length <= MAX_LENGTH) return { text, truncated: false };

  // Режем по границе строки, чтобы не обрывать размер на половине числа.
  const cut = text.slice(0, MAX_LENGTH);
  const lastBreak = cut.lastIndexOf("\n");
  const safe = lastBreak > MAX_LENGTH / 2 ? cut.slice(0, lastBreak) : cut;

  return { text: safe.trim(), truncated: true };
}

/**
 * Готовый блок для сообщения в Telegram. Пустой текст — пустая строка,
 * чтобы у сборщика сообщения не появлялось заголовка без содержимого.
 *
 * @param {string} raw текст клиента
 * @returns {string} HTML-блок или пустая строка
 */
function formatClientMessageBlock(raw) {
  const { text, truncated } = normalizeClientMessage(raw);
  if (!text) return "";

  const tail = truncated
    ? "\n<i>Текст длинный, показан не весь — целиком он в карточке заявки.</i>"
    : "";

  return `\n<b>Что просит клиент:</b>\n${escapeHtml(text)}${tail}`;
}

module.exports = { MAX_LENGTH, normalizeClientMessage, formatClientMessageBlock };
