// ============================================================================
// Детерминированный рендер ответа на запрос дедлайнов по погрузке.
// Модель сюда не пишет номера заявок — только строки из БД.
// ============================================================================

const { formatIsoDateHuman, formatDeadlineCard, escHtml } = require("./messages");

/**
 * @param {{
 *   mode: 'by_date'|'urgent'|'recent_past',
 *   date: string|null,
 *   events: object[],
 *   truncated: boolean,
 *   limit?: number,
 *   limitRequested?: boolean,
 * }} opts
 */
function buildDeadlineQueryMessages({ mode, date, events, truncated, limit, limitRequested }) {
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
    footer =
      events.length === 1
        ? "<i>Есть и другие — скажите, сколько показать, например «5 срочных».</i>"
        : `<i>Показаны первые ${events.length}, есть ещё. Уточните дату или назовите число.</i>`;
  } else if (
    mode === "recent_past" &&
    limitRequested &&
    limit != null &&
    events.length < limit
  ) {
    footer = `<i>Прошедших нашлось только ${events.length} (просили ${limit}).</i>`;
  }

  return {
    empty: false,
    header,
    cards: events.map((event) => formatDeadlineCard(event).text),
    footer,
    parseMode: "HTML",
  };
}

module.exports = {
  buildDeadlineQueryMessages,
};
