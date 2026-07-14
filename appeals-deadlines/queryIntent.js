// ============================================================================
// Интент: просмотр дедлайнов по входящим обращениям (read-only Q&A).
//
// Поток: текст/голос менеджера → Gemini извлекает дату/лимит →
// код читает appeals → детерминированный рендер.
// Каждая заявка — отдельное TG-сообщение (reply на карточку → manage).
// Между карточками — пауза, чтобы не ловить flood от Telegram.
// Никаких пометок «показал менеджеру» в БД.
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { QUERY_SEND_GAP_MS } = require("./config");
const { parseDeadlineQuery } = require("./queryParser");
const { listAppealsForDeadlineQuery } = require("./queries");
const { buildDeadlineQueryMessages } = require("./queryRender");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chatHasTaskPermissions(chat) {
  const perms = chat?.permissions || [];
  return (
    perms.includes(PERMISSIONS.TASK_CREATE) ||
    perms.includes(PERMISSIONS.TASK_ACTIONS)
  );
}

/** Опции отправки в тот же топик форума, откуда пришёл запрос. */
function threadSendOptions(ctx, parseMode) {
  const opts = { disable_web_page_preview: true };
  if (parseMode) opts.parse_mode = parseMode;
  const threadId = ctx.msg?.message_thread_id;
  if (threadId != null) opts.message_thread_id = threadId;
  return opts;
}

async function replyStatus(ctx, text, parseMode) {
  if (ctx.statusMsg?.messageId) {
    await ctx.statusMsg.finalize(text, null, parseMode || undefined);
  } else {
    await sendText(ctx.chatId, text, threadSendOptions(ctx, parseMode));
  }
}

/**
 * Заголовок в statusMsg, затем каждая карточка отдельным сообщением + пауза.
 */
async function sendQueryResult(ctx, messages) {
  const { header, cards, footer, parseMode } = messages;

  await replyStatus(ctx, header, parseMode);

  if (!cards.length) return;

  for (let i = 0; i < cards.length; i++) {
    if (i > 0) await sleep(QUERY_SEND_GAP_MS);
    await sendText(ctx.chatId, cards[i], threadSendOptions(ctx, parseMode));
  }

  if (footer) {
    await sleep(QUERY_SEND_GAP_MS);
    await sendText(ctx.chatId, footer, threadSendOptions(ctx, parseMode));
  }
}

async function handle(ctx) {
  const { chatId, text, chat } = ctx;

  console.log(`[appeals-deadlines/query] старт chat=${chatId} text="${(text || "").slice(0, 100)}"`);

  let parsed;
  try {
    parsed = await parseDeadlineQuery(text, { replyText: ctx.replyText });
  } catch (error) {
    console.error("[appeals-deadlines/query] парсинг упал:", error.message);
    await replyStatus(ctx, "Не удалось обработать запрос о дедлайнах. Попробуйте позже.");
    return;
  }

  if (parsed.status === "error") {
    await replyStatus(ctx, "Не удалось разобрать запрос. Попробуйте сформулировать иначе.");
    return;
  }

  if (parsed.status === "clarify") {
    await replyStatus(ctx, parsed.question);
    return;
  }

  if (parsed.status === "unsupported") {
    await replyStatus(ctx, parsed.message);
    return;
  }

  // Bare «дедлайны» без маркеров входящих — ок только если в чате нет task-интентов.
  if (!parsed.domainOk && chatHasTaskPermissions(chat)) {
    await replyStatus(
      ctx,
      "Уточните: дедлайны по входящим обращениям или по задачам?",
    );
    return;
  }

  let result;
  try {
    result = await listAppealsForDeadlineQuery({
      mode: parsed.mode,
      date: parsed.date,
      limit: parsed.limit,
    });
  } catch (error) {
    console.error("[appeals-deadlines/query] БД:", error.message);
    await replyStatus(ctx, "Не удалось получить дедлайны из базы — попробуйте позже.");
    return;
  }

  const messages = buildDeadlineQueryMessages({
    mode: parsed.mode,
    date: parsed.date,
    appeals: result.appeals,
    truncated: result.truncated,
    limit: parsed.limit,
  });

  console.log(
    `[appeals-deadlines/query] ответ chat=${chatId} mode=${parsed.mode}` +
      ` date=${parsed.date || "—"} found=${result.appeals.length}` +
      ` truncated=${result.truncated} cards=${messages.cards.length}`,
  );

  await sendQueryResult(ctx, messages);
}

module.exports = {
  name: "appeal_deadline_query",
  permission: PERMISSIONS.APPEAL_DEADLINE,
  title: "Просмотр дедлайнов по входящим",
  description:
    "Менеджер СПРАШИВАЕТ / ПРОСИТ ПОКАЗАТЬ активные входящие заявки с дедлайном на дату " +
    "(сегодня, вчера, позавчера) ИЛИ прошедшие/последние без даты " +
    "(N ближайших к сегодня, но раньше сегодня): «дай дедлайны по входящим», " +
    "«дай 5 прошедших дедлайнов», «5 шт прошедшие даты», «дай 5 последних по входящим», " +
    "«самый срочный дедлайн по входящим». " +
    "Это ТОЛЬКО просмотр списка — БЕЗ переноса, отказа, погрузки и добавления инфо. " +
    "НЕ путать с управлением карточкой ДЕДЛАЙН и НЕ путать с дедлайнами manager-задач.",
  examples: [
    "дай дедлайны по входящим на сегодня",
    "покажи две заявки с дедлайном на вчера",
    "дай дедлайны по входящим 5 шт прошедшие даты",
    "дай 5 прошедших дедлайнов по входящим",
    "дай 5 последних дедлайнов по заявкам",
    "есть ли дедлайны по входящим?",
    "все дедлайны по входящим на сегодня",
    "самый срочный дедлайн по входящим",
    "дедлайны по входящим на позавчера",
  ],
  handle,
};
