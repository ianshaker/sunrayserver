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

async function handle(ctx) {
  const { chatId, text, profileId, msg } = ctx;

  console.log(
    `[tasks/create] старт chat=${chatId} authorProfile=${profileId || "null"} ` +
      `tgUser=${msg?.from?.id} text="${text.slice(0, 100)}"`,
  );

  // Автор — тот, кто вызвал бота. Нет в profiles → отказ.
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
    parsed = await parseTaskMessage(text);
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
    const msg =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать запрос. Сформулируйте задачу иначе.";
    await sendText(chatId, msg);
    return;
  }

  if (parsed.status === "rejected") {
    console.log(`[tasks/create] отказ: ${parsed.reason}`);
    await sendText(chatId, buildRejectedMessage(parsed.reason));
    return;
  }

  const draftData = {
    chatId,
    authorProfileId: profileId,
    title: parsed.title,
    description: parsed.description,
    dueDateUtc: parsed.dueDateUtc,
    dueDateHuman: formatMskHuman(parsed.dueDateUtc),
  };

  const draftId = createDraft(draftData);

  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[tasks/create] нет telegramBot для превью");
    return;
  }

  await bot.sendMessage(chatId, buildPreviewMessage(draftData), {
    disable_web_page_preview: true,
    reply_markup: buildPreviewKeyboard(draftId),
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
    "Пользователь просит создать задачу, напоминание, перезвонить, не забыть что-то сделать в указанное время или дату.",
  examples: [
    "Напомни завтра в 10 утра позвонить по номеру 8-903-601-41-36",
    "Поставь задачу перезвонить клиенту в понедельник",
    "Не забудь уточнить размеры у Иванова",
    "Напомни через час проверить статус заказа",
    "Завтра в 14:00 созвон с поставщиком — напомни",
  ],
  handle,
};
