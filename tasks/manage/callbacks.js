// ============================================================================
// Кнопки превью управления задачей: «Сохранить» / «Отменить».
//   tm:save:<draftId>   → выполнить действие
//   tm:cancel:<draftId> → отменить, ничего не менять
// ============================================================================

const { onCallbackQuery } = require("../../tgwebhook");
const { getTelegramBot } = require("../../tgwebhook/bot");
const { ACTIVE_TASK_STATUSES } = require("../config");
const { resolveProfileIdByTelegramUser } = require("../directory");
const { resolveTaskActionPermission } = require("../superUsers");
const {
  fetchTaskByNumberAny,
  completeTask,
  cancelTask,
  deleteTask,
  rescheduleTask,
  editTask,
} = require("../taskActions");
const { takeDraft, getDraft } = require("./draft");
const { parsePreviewCallback } = require("./keyboards");
const {
  buildPreviewDismissedMessage,
  buildCompletedMessage,
  buildCancelledMessage,
  buildDeletedMessage,
  buildRescheduledMessage,
  buildEditedMessage,
  buildAlreadyClosedMessage,
} = require("./messages");
const { sendTaskOriginReply } = require("../originReply");

async function answerCallback(callbackQuery, text) {
  const bot = getTelegramBot();
  if (!bot) return;
  try {
    await bot.answerCallbackQuery(callbackQuery.id, { text });
  } catch (error) {
    console.error("[tasks/manage] answerCallbackQuery:", error.message);
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

/** Reply на origin; превью удаляем — не оставляем лишнее «Подтверждено». */
async function finishManageAction(ctx, task, resultText, parseMode) {
  const bot = getTelegramBot();
  if (!bot) {
    await editMessage(ctx, resultText, parseMode);
    return;
  }

  const sentToOrigin = await sendTaskOriginReply(bot, task, resultText, null, parseMode);
  if (sentToOrigin) {
    try {
      await bot.deleteMessage(ctx.chatId, ctx.messageId);
    } catch (error) {
      console.error("[tasks/manage] не удалось удалить превью:", error.message);
      await editMessage(ctx, resultText, parseMode);
    }
    return;
  }

  await editMessage(ctx, resultText, parseMode);
}

function registerTaskManageCallbacks() {
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
      await answerCallback(callbackQuery, "Черновик устарел — пришлите команду заново");
      try {
        await editMessage(ctx, "⌛️ Черновик устарел. Пришлите команду заново.");
      } catch (_) {}
      return;
    }

    const presserProfileId = await resolveProfileIdByTelegramUser(callbackQuery.from);
    if (presserProfileId !== draft.authorProfileId) {
      await answerCallback(callbackQuery, "Только автор команды может подтвердить");
      return;
    }

    if (action === "cancel") {
      takeDraft(draftId);
      await editMessage(ctx, buildPreviewDismissedMessage());
      await answerCallback(callbackQuery, "Отменено");
      console.log(`[tasks/manage] отмена draft ${draftId} (chat ${chatId})`);
      return;
    }

    if (action !== "save") return;

    const confirmed = takeDraft(draftId);
    if (!confirmed) {
      await answerCallback(callbackQuery, "Черновик устарел — пришлите команду заново");
      return;
    }

    let task;
    try {
      task = await fetchTaskByNumberAny(confirmed.taskNumber);
    } catch (error) {
      console.error("[tasks/manage] выборка задачи при подтверждении:", error.message);
      await answerCallback(callbackQuery, "Не удалось получить задачу");
      return;
    }

    if (!task) {
      await editMessage(ctx, `❌ Задача #${confirmed.taskNumber} не найдена.`);
      await answerCallback(callbackQuery, "Задача не найдена");
      return;
    }

    const access = resolveTaskActionPermission(task, presserProfileId);
    if (!access.allowed) {
      await answerCallback(callbackQuery, "Нет прав на это действие");
      return;
    }

    if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
      await editMessage(ctx, buildAlreadyClosedMessage(task));
      await answerCallback(callbackQuery, "Задача уже закрыта");
      return;
    }

    try {
      if (confirmed.action === "complete") {
        await completeTask(task.id);
        await finishManageAction(ctx, task, buildCompletedMessage(task));
        await answerCallback(callbackQuery, `Задача #${task.task_number} завершена`);
        console.log(`[tasks/manage] complete #${task.task_number} (chat ${chatId})`);
        return;
      }

      if (confirmed.action === "cancel") {
        await cancelTask(task.id);
        await finishManageAction(ctx, task, buildCancelledMessage(task));
        await answerCallback(callbackQuery, `Задача #${task.task_number} отменена`);
        console.log(`[tasks/manage] cancel #${task.task_number} (chat ${chatId})`);
        return;
      }

      if (confirmed.action === "delete") {
        await deleteTask(task.id);
        await finishManageAction(ctx, task, buildDeletedMessage(task));
        await answerCallback(callbackQuery, `Задача #${task.task_number} удалена`);
        console.log(`[tasks/manage] delete #${task.task_number} (chat ${chatId})`);
        return;
      }

      if (confirmed.action === "reschedule") {
        await rescheduleTask(task.id, confirmed.dueDateUtc);
        await finishManageAction(
          ctx,
          task,
          buildRescheduledMessage(task, confirmed.dueDateHuman || "не указано"),
        );
        await answerCallback(callbackQuery, `Задача #${task.task_number} перенесена`);
        console.log(
          `[tasks/manage] reschedule #${task.task_number} → ${confirmed.dueDateUtc} (chat ${chatId})`,
        );
        return;
      }

      if (confirmed.action === "edit") {
        await editTask(task.id, {
          dueDate: confirmed.dueDateUtc || null,
          addAssigneeId: confirmed.extraAssigneeId || null,
          descriptionAppend: confirmed.descriptionAppend || null,
          currentTask: task,
        });
        const edited = buildEditedMessage(task, confirmed);
        await finishManageAction(ctx, task, edited.text, edited.parseMode);
        await answerCallback(callbackQuery, `Задача #${task.task_number} обновлена`);
        console.log(`[tasks/manage] edit #${task.task_number} (chat ${chatId})`);
        return;
      }
    } catch (error) {
      console.error(`[tasks/manage] ошибка ${confirmed.action}:`, error.message);
      await answerCallback(callbackQuery, "Не удалось выполнить действие");
    }
  });

  console.log("[tasks/manage] кнопки превью: сохранить / отменить");
}

module.exports = { registerTaskManageCallbacks };
