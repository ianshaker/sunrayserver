// ============================================================================
// Детерминированный рендер ответа на запрос дедлайнов по входящим.
// Модель сюда не пишет номера заявок — только строки из БД.
// Каждая заявка — отдельное TG-сообщение (чтобы можно было reply).
// ============================================================================

const { DIALOG_MAX_CHARS } = require("./config");

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatIsoDateHuman(isoDate) {
  if (!isoDate) return isoDate;
  const [, m, d] = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  if (!m || !d) return isoDate;
  return `${parseInt(d, 10)} ${MONTHS_RU[parseInt(m, 10) - 1]}`;
}

/**
 * Карточка просмотра (без memo про закрытие дедлайна).
 * @param {object} appeal
 * @returns {string} HTML
 */
function formatQueryCard(appeal) {
  const lines = [];

  lines.push(`⏰ <b>ДЕДЛАЙН ${escHtml(appeal.appeal_number)}</b>`);
  if (appeal.reminder_date) {
    lines.push(`📅 ${escHtml(formatIsoDateHuman(appeal.reminder_date))}`);
  }
  lines.push("");

  const name = (appeal.client_name || "").trim();
  const phone = (appeal.phone || "").trim();
  if (name || phone) {
    lines.push(`${escHtml(name)} ${escHtml(phone)}`.trim());
  }

  const city = (appeal.city || "").trim();
  if (city) {
    lines.push(`🏙 ${escHtml(city)}`);
  }

  const addr = (appeal.detailed_address || appeal.address || "").trim();
  if (addr) {
    lines.push(`📍 ${escHtml(addr)}`);
  }

  const dialog = (appeal.dialog || "").trim();
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
 * Собирает тексты для отправки: заголовок + N карточек (+ опц. хвост).
 * Карточки намеренно разделены — менеджер сможет reply на конкретную заявку.
 *
 * @param {{
 *   mode: 'by_date'|'urgent'|'recent_past',
 *   date: string|null,
 *   appeals: object[],
 *   truncated: boolean,
 *   limit?: number,
 * }} opts
 * @returns {{
 *   empty: boolean,
 *   header: string,
 *   cards: string[],
 *   footer: string|null,
 *   parseMode: 'HTML',
 * }}
 */
function buildDeadlineQueryMessages({ mode, date, appeals, truncated, limit }) {
  if (!appeals.length) {
    if (mode === "urgent") {
      return {
        empty: true,
        header:
          "Сейчас нет активных входящих с дедлайном на сегодня или раньше.\n" +
          "Можно спросить про конкретную дату, например «дедлайны по входящим на вчера».",
        cards: [],
        footer: null,
        parseMode: "HTML",
      };
    }
    if (mode === "recent_past") {
      return {
        empty: true,
        header:
          "Прошедших дедлайнов по входящим нет.\n" +
          "Можно спросить на конкретную дату («на вчера») или «дедлайны по входящим на сегодня».",
        cards: [],
        footer: null,
        parseMode: "HTML",
      };
    }
    const human = formatIsoDateHuman(date);
    return {
      empty: true,
      header:
        `На <b>${escHtml(human)}</b> активных входящих с дедлайном нет.\n` +
        `Можно спросить прошедшие («дай 5 прошедших») или другую дату.`,
      cards: [],
      footer: null,
      parseMode: "HTML",
    };
  }

  let header;
  if (mode === "urgent") {
    header =
      appeals.length === 1
        ? "Самый срочный дедлайн по входящим:"
        : `Срочные дедлайны по входящим (${appeals.length}):`;
  } else if (mode === "recent_past") {
    header =
      appeals.length === 1
        ? "Ближайший прошедший дедлайн по входящим:"
        : `Прошедшие дедлайны по входящим (ближе к сегодня) — ${appeals.length}:`;
  } else {
    const human = formatIsoDateHuman(date);
    header = `Дедлайны по входящим на <b>${escHtml(human)}</b> (${appeals.length}):`;
  }

  let footer = null;
  if (truncated) {
    footer = `<i>Показаны первые ${appeals.length}. Чтобы сузить — попросите число, например «две заявки».</i>`;
  } else if (
    mode === "recent_past" &&
    limit != null &&
    appeals.length < limit
  ) {
    footer = `<i>Прошедших нашлось только ${appeals.length} (просили ${limit}).</i>`;
  }

  return {
    empty: false,
    header,
    cards: appeals.map(formatQueryCard),
    footer,
    parseMode: "HTML",
  };
}

module.exports = {
  formatIsoDateHuman,
  formatQueryCard,
  buildDeadlineQueryMessages,
};
