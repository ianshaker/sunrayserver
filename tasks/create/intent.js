// ============================================================================
// Интент: создание задачи / напоминания из Telegram.
//
// Поток: автор (отправитель) → парсинг Gemini → превью с кнопками.
// Создание задачи происходит по кнопке «Сохранить» (см. callbacks.js).
// ============================================================================

const { PERMISSIONS } = require("../../lib/telegramBotChats");
const { sendText } = require("../../assistant/reply");
const { getTelegramBot } = require("../../tgwebhook/bot");
const { parseTaskMessage } = require("./parser");
const { formatMskHuman } = require("./time");
const { createDraft } = require("./draft");
const { buildPreviewMessage, buildRejectedMessage } = require("./messages");
const { buildPreviewKeyboard } = require("./keyboards");
const { getRoster } = require("./assigneeRoster");
const {
  resolveReplyAuthor,
  mergeCoAssigneeIds,
  appendReplyAuthorNote,
} = require("./replyAuthor");

async function handle(ctx) {
  const { chatId, text, replyText, replyFrom, profileId, msg } = ctx;

  console.log(
    `[tasks/create] старт chat=${chatId} authorProfile=${profileId || "null"} ` +
      `tgUser=${msg?.from?.id} text="${text.slice(0, 100)}"` +
      (replyText ? ` replyCtx="${replyText.slice(0, 60)}"` : ""),
  );

  if (!profileId) {
    console.log(`[tasks/create] отказ: профиль не найден для tg user ${msg?.from?.id}`);
    await sendText(
      chatId,
      "Вы не зарегистрированы в системе менеджеров — задача не создана. Обратитесь к администратору.",
    );
    return;
  }

  let parsed;
  try {
    parsed = await parseTaskMessage(text, { replyText });
    console.log(
      `[tasks/create] parse → status=${parsed.status}` +
        (parsed.status === "ok"
          ? ` title="${parsed.title}" due=${parsed.dueDateMskLocal}`
          : parsed.reason
            ? ` reason="${parsed.reason}"`
            : parsed.error
              ? ` error=${parsed.error}`
              : ""),
    );
  } catch (error) {
    console.error("[tasks/create] парсинг упал:", error.message);
    await sendText(chatId, "Не удалось обработать запрос. Попробуйте позже.");
    return;
  }

  if (parsed.status === "error") {
    const errMsg =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать запрос. Сформулируйте задачу иначе.";
    await sendText(chatId, errMsg);
    return;
  }

  if (parsed.status === "rejected") {
    console.log(`[tasks/create] отказ: ${parsed.reason}`);
    await sendText(chatId, buildRejectedMessage(parsed.reason));
    return;
  }

  let description = parsed.description;
  let coAssigneeIds = parsed.extraAssigneeId ? [parsed.extraAssigneeId] : [];

  if (replyFrom) {
    const { profileId: replyAuthorId, unknownLabel } = await resolveReplyAuthor(replyFrom);
    if (replyAuthorId) {
      coAssigneeIds = mergeCoAssigneeIds(replyAuthorId, parsed.extraAssigneeId);
      console.log(
        `[tasks/create] replyAuthor → co-assignee ${replyAuthorId}` +
          (replyAuthorId === profileId ? " (тот же, что вызвал бота)" : ""),
      );
    } else if (unknownLabel) {
      description = appendReplyAuthorNote(description, unknownLabel);
      console.log(`[tasks/create] replyAuthor → не в БД, note: ${unknownLabel}`);
    }
  }

  const roster = await getRoster();
  const coAssigneeProfiles = coAssigneeIds
    .map((id) => roster.find((p) => p.id === id))
    .filter(Boolean);

  const draftData = {
    chatId,
    authorProfileId: profileId,
    title: parsed.title,
    description,
    dueDateUtc: parsed.dueDateUtc,
    dueDateHuman: formatMskHuman(parsed.dueDateUtc),
    coAssigneeIds,
    coAssigneeProfiles,
  };

  const draftId = createDraft(draftData);

  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[tasks/create] нет telegramBot для превью");
    return;
  }

  const preview = buildPreviewMessage(draftData);
  await bot.sendMessage(chatId, preview.text, {
    disable_web_page_preview: true,
    reply_markup: buildPreviewKeyboard(draftId),
    ...(preview.parseMode ? { parse_mode: preview.parseMode } : {}),
  });

  console.log(
    `[tasks/create] превью: chat ${chatId}, draft ${draftId}, ` +
      `«${parsed.title}» на ${draftData.dueDateHuman}`,
  );
}

module.exports = {
  name: "task_create",
  permission: PERMISSIONS.TASK_CREATE,
  title: "Создание задачи / напоминания",
  description:
    "Пользователь просит создать НОВУЮ задачу или напоминание: перезвонить, не забыть, напомнить что-то сделать в указанное время или дату. Это создание новой задачи, а НЕ действие над уже существующей (без отмены/завершения/переноса по номеру).",
  examples: [
    "Напомни завтра в 10 утра позвонить по номеру 8-903-601-41-36",
    "Поставь задачу перезвонить клиенту в понедельник",
    "Не забудь уточнить размеры у Иванова",
    "Напомни через час проверить статус заказа",
    "Завтра в 14:00 созвон с поставщиком — напомни",
  ],
  handle,
};
