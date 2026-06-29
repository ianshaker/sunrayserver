const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveAssigneeIds } = require("./assignees");
const { getUserIdsForChatId } = require("./chatMapping");
const { snoozeTaskByNumber, completeTaskByNumber, fetchActiveTaskByNumber } = require("./taskActions");
const {
  getMessageContext,
  setButtonsLoading,
  restoreButtons,
  finishWithFooter,
} = require("./callbackUi");

const CALLBACK_RE = /^mt:(sn|ok):(\d+)$/;

const LOADING_LABEL = {
  sn: "⏳ Откладываю…",
  ok: "⏳ Закрываю…",
};

function parseCallbackData(data) {
  const match = String(data || "").match(CALLBACK_RE);
  if (!match) return null;
  return { action: match[1], taskNumber: Number(match[2]) };
}

function chatMayActOnTask(task, chatId) {
  const chatUserIds = getUserIdsForChatId(chatId);
  if (!chatUserIds.length) return false;

  const assigneeIds = resolveAssigneeIds(task);
  return assigneeIds.some((id) => chatUserIds.includes(id));
}

async function answerCallback(callbackQuery, text) {
  const bot = getTelegramBot();
  if (!bot) return;
  await bot.answerCallbackQuery(callbackQuery.id, { text });
}

function registerTaskCallbackHandlers() {
  onCallbackQuery(async (callbackQuery) => {
    if (callbackQuery.data === "mt:noop") {
      await answerCallback(callbackQuery, "Подождите…");
      return;
    }

    const parsed = parseCallbackData(callbackQuery.data);
    if (!parsed) return;

    const chatId = callbackQuery.message?.chat?.id;
    if (chatId == null) return;

    const bot = getTelegramBot();
    const ctx = getMessageContext(callbackQuery);
    const { action, taskNumber } = parsed;

    try {
      const task = await fetchActiveTaskByNumber(taskNumber);
      if (!task) {
        await answerCallback(callbackQuery, "Задача не найдена или уже закрыта");
        return;
      }
      if (!chatMayActOnTask(task, chatId)) {
        await answerCallback(callbackQuery, "Нет доступа к этой задаче");
        return;
      }

      // Показываем «Делаю…» на кнопках, toast — один раз в конце.
      if (bot && ctx) {
        await setButtonsLoading(bot, ctx, LOADING_LABEL[action] || "⏳ Делаю…");
      }

      if (action === "sn") {
        const result = await snoozeTaskByNumber(taskNumber);
        if (!result.ok) {
          if (bot && ctx) await restoreButtons(bot, ctx, taskNumber);
          await answerCallback(callbackQuery, "Не удалось отложить задачу");
          return;
        }
        if (bot && ctx) {
          await finishWithFooter(
            bot,
            ctx,
            `⏰ Задача #${taskNumber} отложена на 1 час`,
          );
        }
        await answerCallback(callbackQuery, `Задача #${taskNumber} отложена на 1 час`);
        console.log(`[tasks/callback] snooze #${taskNumber} из chat ${chatId}`);
        return;
      }

      if (action === "ok") {
        const result = await completeTaskByNumber(taskNumber);
        if (!result.ok) {
          if (bot && ctx) await restoreButtons(bot, ctx, taskNumber);
          await answerCallback(callbackQuery, "Не удалось закрыть задачу");
          return;
        }
        if (bot && ctx) {
          await finishWithFooter(
            bot,
            ctx,
            `✅ Задача #${taskNumber} выполнена`,
          );
        }
        await answerCallback(callbackQuery, `Задача #${taskNumber} выполнена ✅`);
        console.log(`[tasks/callback] complete #${taskNumber} из chat ${chatId}`);
      }
    } catch (error) {
      console.error("[tasks/callback] ошибка:", error.message);
      if (bot && ctx) {
        try {
          await restoreButtons(bot, ctx, taskNumber);
        } catch (restoreError) {
          console.error("[tasks/callback] не удалось вернуть кнопки:", restoreError.message);
        }
      }
      await answerCallback(callbackQuery, "Ошибка, попробуйте позже");
    }
  });

  console.log("[tasks/callback] кнопки задач: отложить / выполнено");
}

module.exports = { registerTaskCallbackHandlers };
