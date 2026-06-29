// ============================================================================
// Кнопки превью задачи: «Сохранить» / «Отменить».
//   tc:save:<draftId>   → создать задачу
//   tc:cancel:<draftId> → отменить, ничего не создавать
// ============================================================================

const { onCallbackQuery } = require("../../tgwebhook");
const { getTelegramBot } = require("../../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("../directory");
const { takeDraft, getDraft } = require("./draft");
const { parsePreviewCallback } = require("./keyboards");
const { insertManagerTask, attachTelegramOrigin } = require("./createTask");
const { buildCreatedMessage, buildCancelledMessage } = require("./messages");

async function answerCallback(callbackQuery, text) {
  const bot = getTelegramBot();
  if (!bot) return;
  try {
    await bot.answerCallbackQuery(callbackQuery.id, { text });
  } catch (error) {
    console.error("[tasks/create] answerCallbackQuery:", error.message);
  }
}

async function editMessage(ctx, text, parseMode) {
  const bot = getTelegramBot();
  if (!bot) return;
  await bot.editMessageText(text, {
    chat_id: ctx.chatId,
    message_id: ctx.messageId,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
    ...(parseMode ? { parse_mode: parseMode } : {}),
  });
}

function registerTaskCreateCallbacks() {
  onCallbackQuery(async (callbackQuery) => {
    const parsed = parsePreviewCallback(callbackQuery.data);
    if (!parsed) return;

    const { action, draftId } = parsed;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    if (chatId == null || messageId == null) return;

    const ctx = { chatId, messageId };

    const draft = getDraft(draftId);
    if (!draft) {
      await answerCallback(callbackQuery, "Черновик устарел — пришлите запрос заново");
      try {
        await editMessage(ctx, "⌛️ Черновик устарел. Пришлите запрос заново.");
      } catch (_) {}
      return;
    }

    // Подтвердить может только автор черновика.
    const presserProfileId = await resolveProfileIdByTelegramUser(callbackQuery.from);
    if (presserProfileId !== draft.authorProfileId) {
      await answerCallback(callbackQuery, "Только автор может подтвердить задачу");
      return;
    }

    if (action === "cancel") {
      takeDraft(draftId);
      const cancelled = buildCancelledMessage();
      await editMessage(ctx, cancelled.text, cancelled.parseMode);
      await answerCallback(callbackQuery, "Отменено");
      console.log(`[tasks/create] отмена draft ${draftId} (chat ${chatId})`);
      return;
    }

    if (action === "save") {
      const confirmed = takeDraft(draftId);
      if (!confirmed) {
        await answerCallback(callbackQuery, "Черновик устарел — пришлите запрос заново");
        return;
      }

      try {
        const task = await insertManagerTask({
          authorProfileId: confirmed.authorProfileId,
          title: confirmed.title,
          description: confirmed.description,
          dueDateUtc: confirmed.dueDateUtc,
          coAssigneeIds: confirmed.coAssigneeIds || [],
        });

        const created = buildCreatedMessage(task.task_number, confirmed);
        await editMessage(ctx, created.text, created.parseMode);
        // message_id отбивки = текущее сообщение → напоминание придёт reply на него.
        await attachTelegramOrigin(task.id, chatId, messageId);

        await answerCallback(callbackQuery, `Задача #${task.task_number} создана`);
        console.log(
          `[tasks/create] создана #${task.task_number} (chat ${chatId}, author ${confirmed.authorProfileId})`,
        );
      } catch (error) {
        console.error("[tasks/create] ошибка создания:", error.message);
        await answerCallback(callbackQuery, "Не удалось создать задачу");
      }
    }
  });

  console.log("[tasks/create] кнопки превью: сохранить / отменить");
}

module.exports = { registerTaskCreateCallbacks };
