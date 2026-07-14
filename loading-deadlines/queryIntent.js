// ============================================================================
// Интент: просмотр дедлайнов по погрузке (read-only Q&A).
//
// Поток: текст/голос менеджера → Gemini извлекает дату/лимит →
// код читает eventsnew (type=Погрузка) → детерминированный рендер.
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { QUERY_SEND_GAP_MS } = require("./config");
const { parseDeadlineQuery } = require("./queryParser");
const { listLoadingDeadlinesForQuery } = require("./queries");
const { buildDeadlineQueryMessages } = require("./queryRender");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chatHasTaskPermissions(chat) {
  const perms = chat?.permissions || [];
  return (
    perms.includes(PERMISSIONS.TASK_CREATE) ||
    perms.includes(PERMISSIONS.TASK_ACTIONS)
  );
}

/** В чате только погрузка (без входящих) — bare «дедлайны» = дедлайны погрузки. */
function chatIsLoadingDeadlineOnly(chat) {
  const perms = chat?.permissions || [];
  return (
    perms.includes(PERMISSIONS.LOADING_DEADLINE) &&
    !perms.includes(PERMISSIONS.APPEAL_DEADLINE)
  );
}

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

  console.log(
    `[loading-deadlines/query] старт chat=${chatId} text="${(text || "").slice(0, 100)}"`,
  );

  let parsed;
  try {
    parsed = await parseDeadlineQuery(text, { replyText: ctx.replyText });
  } catch (error) {
    console.error("[loading-deadlines/query] парсинг упал:", error.message);
    await replyStatus(ctx, "Не удалось обработать запрос о дедлайнах погрузки. Попробуйте позже.");
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

  // Bare «дедлайны» без маркеров: в чате НА ЗАМЕР / погрузка — это про погрузку.
  // Иначе, если есть task-права — уточняем.
  if (!parsed.domainOk && !chatIsLoadingDeadlineOnly(chat) && chatHasTaskPermissions(chat)) {
    await replyStatus(
      ctx,
      "Уточните: дедлайны по погрузке или по задачам?",
    );
    return;
  }

  let result;
  try {
    result = await listLoadingDeadlinesForQuery({
      mode: parsed.mode,
      date: parsed.date,
      limit: parsed.limit,
    });
  } catch (error) {
    console.error("[loading-deadlines/query] БД:", error.message);
    await replyStatus(ctx, "Не удалось получить дедлайны погрузки из базы — попробуйте позже.");
    return;
  }

  const messages = buildDeadlineQueryMessages({
    mode: parsed.mode,
    date: parsed.date,
    events: result.events,
    truncated: result.truncated,
  });

  console.log(
    `[loading-deadlines/query] ответ chat=${chatId} mode=${parsed.mode}` +
      ` date=${parsed.date || "—"} found=${result.events.length}` +
      ` truncated=${result.truncated} cards=${messages.cards.length}`,
  );

  await sendQueryResult(ctx, messages);
}

module.exports = {
  name: "loading_deadline_query",
  permission: PERMISSIONS.LOADING_DEADLINE,
  title: "Просмотр дедлайнов по погрузке",
  description:
    "Менеджер СПРАШИВАЕТ / ПРОСИТ ПОКАЗАТЬ события отдела погрузки с дедлайном на дату " +
    "(сегодня, вчера, конкретная дата): «дай дедлайны по погрузке», «скинь дедлайны по замерам», " +
    "«дай 7 дедлайнов по погрузке», «10 дедлайнов на вчера», «все дедлайны», " +
    "«самый срочный дедлайн по погрузке». " +
    "В чате погрузки / НА ЗАМЕР даже bare «дай дедлайны» / «дай 5 дедлайнов» — это этот intent. " +
    "Это ТОЛЬКО просмотр списка — БЕЗ переноса и других действий. " +
    "НЕ путать с дедлайнами входящих обращений и НЕ путать с дедлайнами manager-задач.",
  examples: [
    "дай дедлайны по погрузке на сегодня",
    "скинь дедлайны по погрузке",
    "дай дедлайны по замерам",
    "дедлайны по замерам на вчера",
    "дай 7 дедлайнов по погрузке",
    "дай 10 дедлайнов на вчера",
    "покажи две заявки с дедлайном в погрузке",
    "все дедлайны по погрузке на сегодня",
    "есть ли дедлайны по погрузке?",
    "самый срочный дедлайн по погрузке",
    "дай дедлайны",
  ],
  handle,
};
