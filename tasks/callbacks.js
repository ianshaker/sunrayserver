const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("./directory");
const { resolveTaskActionPermission } = require("./superUsers");
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

function successToast(action, taskNumber, access) {
  if (access.elevated) {
    return action === "sn" ? "Задача отложена" : "Задача выполнена";
  }
  if (action === "sn") return `Задача #${taskNumber} отложена на 1 час`;
  return `Задача #${taskNumber} выполнена ✅`;
}

function buildActionFooter(action, taskNumber, access) {
  const main =
    action === "sn"
      ? `⏰ Задача #${taskNumber} отложена на 1 час`
      : `✅ Задача #${taskNumber} выполнена`;

  if (!access.elevated) return main;

  const notice = action === "sn" ? access.noticeSnooze : access.noticeComplete;
  return `${main}\n${notice}`;
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

      const profileId = await resolveProfileIdByTelegramUser(callbackQuery.from);
      const access = resolveTaskActionPermission(task, profileId);
      if (!access.allowed) {
        await answerCallback(callbackQuery, "Только участники задачи могут её менять");
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
            buildActionFooter("sn", taskNumber, access),
          );
        }
        await answerCallback(callbackQuery, successToast("sn", taskNumber, access));
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
            buildActionFooter("ok", taskNumber, access),
          );
        }
        await answerCallback(callbackQuery, successToast("ok", taskNumber, access));
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
