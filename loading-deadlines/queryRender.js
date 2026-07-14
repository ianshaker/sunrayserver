// ============================================================================
// Детерминированный рендер ответа на запрос дедлайнов по погрузке.
// Модель сюда не пишет номера заявок — только строки из БД.
// ============================================================================

const { DIALOG_MAX_CHARS } = require("./config");
const { formatIsoDateHuman, escHtml, normalizeAppealNumber } = require("./messages");

/**
 * Карточка просмотра (без memo про закрытие дедлайна).
 * @param {object} event
 * @returns {string} HTML
 */
function formatQueryCard(event) {
  const lines = [];
  const num = normalizeAppealNumber(event.appeal_number);

  lines.push(`⏰ <b>ДЕДЛАЙН ПОГРУЗКИ ${escHtml(num)}</b>`);
  if (event.deadline) {
    lines.push(`📅 ${escHtml(formatIsoDateHuman(event.deadline))}`);
  }
  lines.push("");

  const name = (event.client_name || "").trim();
  const phone = (event.phone || "").trim();
  if (name || phone) {
    lines.push(`${escHtml(name)} ${escHtml(phone)}`.trim());
  }

  const city = (event.city || "").trim();
  if (city) {
    lines.push(`🏙 ${escHtml(city)}`);
  }

  const addr = (event.detailed_address || event.address || "").trim();
  if (addr) {
    lines.push(`📍 ${escHtml(addr)}`);
  }

  const note = (event.note || "").trim();
  if (note) {
    lines.push("");
    lines.push("📝 <b>Заметка:</b>");
    const truncated =
      note.length > DIALOG_MAX_CHARS
        ? note.slice(0, DIALOG_MAX_CHARS) + "…"
        : note;
    lines.push(escHtml(truncated));
  }

  const dialog = (event.dialog || "").trim();
  if (dialog) {
    lines.push("");
    lines.push("💬 <b>Диалог:</b>");
    const truncated =
      dialog.length > DIALOG_MAX_CHARS
        ? dialog.slice(0, DIALOG_MAX_CHARS) + "…"
        : dialog;
    lines.push(escHtml(truncated));
  }

  return lines.join("\n");
}

/**
 * @param {{
 *   mode: 'by_date'|'urgent'|'recent_past',
 *   date: string|null,
 *   events: object[],
 *   truncated: boolean,
 *   limit?: number,
 * }} opts
 */
function buildDeadlineQueryMessages({ mode, date, events, truncated, limit }) {
  if (!events.length) {
    if (mode === "urgent") {
      return {
        empty: true,
        header:
          "Сейчас нет событий погрузки с дедлайном на сегодня или раньше.\n" +
          "Можно спросить про конкретную дату, например «дедлайны по погрузке на вчера».",
        cards: [],
        footer: null,
        parseMode: "HTML",
      };
    }
    if (mode === "recent_past") {
      return {
        empty: true,
        header:
          "Прошедших дедлайнов по погрузке нет.\n" +
          "Можно спросить на конкретную дату («на вчера») или «дедлайны по погрузке на сегодня».",
        cards: [],
        footer: null,
        parseMode: "HTML",
      };
    }
    const human = formatIsoDateHuman(date);
    return {
      empty: true,
      header:
        `На <b>${escHtml(human)}</b> событий погрузки с дедлайном нет.\n` +
        `Можно спросить прошедшие («дай 5 прошедших») или другую дату.`,
      cards: [],
      footer: null,
      parseMode: "HTML",
    };
  }

  let header;
  if (mode === "urgent") {
    header =
      events.length === 1
        ? "Самый срочный дедлайн по погрузке:"
        : `Срочные дедлайны по погрузке (${events.length}):`;
  } else if (mode === "recent_past") {
    header =
      events.length === 1
        ? "Ближайший прошедший дедлайн по погрузке:"
        : `Прошедшие дедлайны по погрузке (ближе к сегодня) — ${events.length}:`;
  } else {
    const human = formatIsoDateHuman(date);
    header = `Дедлайны по погрузке на <b>${escHtml(human)}</b> (${events.length}):`;
  }

  let footer = null;
  if (truncated) {
    footer = `<i>Показаны первые ${events.length}. Чтобы сузить — попросите число, например «две заявки».</i>`;
  } else if (
    mode === "recent_past" &&
    limit != null &&
    events.length < limit
  ) {
    footer = `<i>Прошедших нашлось только ${events.length} (просили ${limit}).</i>`;
  }

  return {
    empty: false,
    header,
    cards: events.map(formatQueryCard),
    footer,
    parseMode: "HTML",
  };
}

module.exports = {
  formatQueryCard,
  buildDeadlineQueryMessages,
};
