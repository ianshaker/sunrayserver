// ============================================================================
// Утренняя сводка по дедлайнам погрузки — 9:00 МСК в чат «НА ЗАМЕР».
//
// Одно сообщение: на сегодня, без дедлайна, просрочено. Кнопки под ним
// присылают карточки блока (до 10) с кнопками «Завтра / +3 / +7 / Отказ».
// Карусель и пинги из worker.js сводка не трогает — это условие Яна.
//
// Защиты от двойной отправки в минуту выкладки нет сознательно: 20 выкладок
// с 31.08.2026 — ни одной около 9 утра; худший случай — лишнее сообщение.
// ============================================================================

const schedule = require("node-schedule");
const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { answerCallback } = require("./callbacks");
const { TIMEZONE } = require("../lib/mskTime");
const {
  LOADING_DEADLINE_CHAT_ID,
  QUERY_LIST_CAP,
  QUERY_SEND_GAP_MS,
  DIGEST_CRON_MSK,
  DIGEST_PREVIEW_LIMIT,
  DIGEST_BUTTON_COOLDOWN_MS,
} = require("./config");
const {
  getDailyDigestData,
  listLoadingDeadlinesForQuery,
  listLoadingWithoutDeadline,
  getMskTodayDate,
} = require("./queries");
const { formatDailyDigest, formatDeadlineCard } = require("./messages");
const { buildDigestKeyboard, parseDigestCallback, buildCardKeyboard } = require("./keyboards");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Собирает и отправляет сводку.
 *
 * @param {object} bot
 */
async function runDailyDigest(bot) {
  const data = await getDailyDigestData({
    todayLimit: QUERY_LIST_CAP,
    withoutLimit: DIGEST_PREVIEW_LIMIT,
  });

  const text = formatDailyDigest(data);
  const keyboard = buildDigestKeyboard({
    today: data.onToday.count > 0,
    none: data.withoutDeadline.count > 0,
    over: data.overdue.count > 0,
  });

  const sent = await bot.sendMessage(LOADING_DEADLINE_CHAT_ID, text, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });

  console.log(
    `[loading-deadlines/digest] ✅ сводка ${data.today} → msg_id=${sent?.message_id} ` +
      `сегодня=${data.onToday.count} без_дедлайна=${data.withoutDeadline.count} ` +
      `просрочено=${data.overdue.count}`,
  );
}

function startLoadingDeadlineDigest(bot) {
  schedule.scheduleJob({ rule: DIGEST_CRON_MSK, tz: TIMEZONE }, () => {
    runDailyDigest(bot).catch((error) =>
      console.error("[loading-deadlines/digest] сводка не ушла:", error.message),
    );
  });
  console.log(`[loading-deadlines] сводка запланирована: ${DIGEST_CRON_MSK} (Москва)`);
}

// ---------------------------------------------------------------------------
// Кнопки под сводкой
// ---------------------------------------------------------------------------

/** Когда последний раз нажимали кнопку блока — замок от завала чата. */
const lastPressAt = new Map();

/**
 * Карточки блока на момент нажатия и сколько их всего.
 * `order` — как отобраны первые, если прислано не всё: говорим это человеку.
 *
 * @returns {Promise<{ events: object[], total: number, order: string }>}
 */
async function loadBlockEvents(block) {
  if (block === "today") {
    const res = await listLoadingDeadlinesForQuery({
      mode: "by_date",
      date: getMskTodayDate(),
      limit: QUERY_LIST_CAP,
    });
    return { events: res.events, total: res.totalMatched, order: "по времени" };
  }
  if (block === "over") {
    // Ближайшие к сегодня: они ещё тёплые, самые старые и так идут каруселью.
    const res = await listLoadingDeadlinesForQuery({
      mode: "recent_past",
      date: null,
      limit: QUERY_LIST_CAP,
    });
    return {
      events: res.events,
      total: res.totalMatched,
      order: "ближайшие к сегодня, самые старые бот и так напоминает по очереди",
    };
  }
  const res = await listLoadingWithoutDeadline(QUERY_LIST_CAP);
  return { events: res.events, total: res.count, order: "самые новые" };
}

const cooldownMinutes = (ms) => Math.max(1, Math.ceil(ms / 60000));

function registerLoadingDeadlineDigestButtons() {
  onCallbackQuery(async (callbackQuery) => {
    const parsed = parseDigestCallback(callbackQuery.data);
    if (!parsed) return;

    const chatId = callbackQuery.message?.chat?.id;
    if (chatId !== LOADING_DEADLINE_CHAT_ID) return;

    const { block } = parsed;
    const now = Date.now();
    const waitMs = DIGEST_BUTTON_COOLDOWN_MS - (now - (lastPressAt.get(block) || 0));
    if (waitMs > 0) {
      await answerCallback(
        callbackQuery,
        `Уже прислал — снова можно через ${cooldownMinutes(waitMs)} мин`,
      );
      return;
    }
    lastPressAt.set(block, now);

    let loaded;
    try {
      loaded = await loadBlockEvents(block);
    } catch (error) {
      lastPressAt.delete(block);
      console.error(`[loading-deadlines/digest] кнопка ${block}:`, error.message);
      await answerCallback(callbackQuery, "Не удалось получить заявки");
      return;
    }

    const { events, total, order } = loaded;
    if (!events.length) {
      // Ничего не прислали — замок не нужен: появится заявка, нажмут снова.
      lastPressAt.delete(block);
      await answerCallback(callbackQuery, "Сейчас таких заявок нет");
      return;
    }

    const partial = total > events.length;
    await answerCallback(
      callbackQuery,
      partial ? `Присылаю ${events.length} из ${total}` : `Присылаю ${events.length}`,
    );
    const bot = getTelegramBot();
    for (let i = 0; i < events.length; i++) {
      if (i > 0) await sleep(QUERY_SEND_GAP_MS);
      const { text, parseMode } = formatDeadlineCard(events[i]);
      try {
        await bot.sendMessage(chatId, text, {
          parse_mode: parseMode,
          disable_web_page_preview: true,
          reply_markup: buildCardKeyboard(events[i].id),
        });
      } catch (error) {
        console.error(
          `[loading-deadlines/digest] карточка ${events[i].appeal_number}:`,
          error.message,
        );
      }
    }
    if (partial) {
      await sleep(QUERY_SEND_GAP_MS);
      try {
        await bot.sendMessage(
          chatId,
          `<i>Показаны ${events.length} из ${total} — ${order}. Разберите их кнопками и нажмите ` +
            `снова через ${cooldownMinutes(DIGEST_BUTTON_COOLDOWN_MS)} мин — придут остальные.</i>`,
          { parse_mode: "HTML", disable_web_page_preview: true },
        );
      } catch (error) {
        console.error("[loading-deadlines/digest] строка «показаны N из M»:", error.message);
      }
    }
    console.log(
      `[loading-deadlines/digest] кнопка ${block}: прислано ${events.length} из ${total}`,
    );
  });

  console.log("[loading-deadlines] кнопки сводки: на сегодня / без дедлайна / просрочено");
}

module.exports = {
  startLoadingDeadlineDigest,
  registerLoadingDeadlineDigestButtons,
};
