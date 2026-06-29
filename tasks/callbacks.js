const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("./directory");
const { resolveTaskActionPermission } = require("./superUsers");
const {
  SNOOZE_PRESETS,
  snoozeTaskByNumber,
  completeTaskByNumber,
  fetchActiveTaskByNumber,
} = require("./taskActions");
const {
  getMessageContext,
  setButtonsLoading,
  restoreButtons,
  finishWithFooter,
} = require("./callbackUi");

const CALLBACK_RE = /^mt:(10|30|1h|tm|sn|ok):(\d+)$/;

const LOADING_LABEL = {
  snooze: "⏳ Переношу…",
  ok: "⏳ Закрываю…",
};

function parseCallbackData(data) {
  const match = String(data || "").match(CALLBACK_RE);
  if (!match) return null;
  let action = match[1];
  if (action === "sn") action = "1h";
  return { action, taskNumber: Number(match[2]) };
}

function snoozeLabel(presetKey) {
  return SNOOZE_PRESETS[presetKey]?.label || presetKey;
}

function successToast(action, taskNumber, access, presetKey) {
  if (access.elevated) {
    return action === "ok" ? "Задача завершена" : "Дедлайн перенесён";
  }
  if (action === "ok") return `Задача #${taskNumber} завершена`;
  return `#${taskNumber} → ${snoozeLabel(presetKey)}`;
}

function buildActionFooter(action, taskNumber, access, presetKey) {
  const main =
    action === "ok"
      ? `✅ Задача #${taskNumber} завершена`
      : `⏰ Задача #${taskNumber} → ${snoozeLabel(presetKey)}`;

  if (!access.elevated) return main;

  const notice = action === "ok" ? access.noticeComplete : access.noticeSnooze;
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
    const isSnooze = action !== "ok";

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

      if (bot && ctx) {
        await setButtonsLoading(
          bot,
          ctx,
          isSnooze ? LOADING_LABEL.snooze : LOADING_LABEL.ok,
        );
      }

      if (isSnooze) {
        const result = await snoozeTaskByNumber(taskNumber, action);
        if (!result.ok) {
          if (bot && ctx) await restoreButtons(bot, ctx, taskNumber);
          await answerCallback(callbackQuery, "Не удалось перенести задачу");
          return;
        }
        if (bot && ctx) {
          await finishWithFooter(
            bot,
            ctx,
            buildActionFooter("snooze", taskNumber, access, action),
          );
        }
        await answerCallback(callbackQuery, successToast("snooze", taskNumber, access, action));
        console.log(`[tasks/callback] snooze #${taskNumber} → ${action} из chat ${chatId}`);
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

  console.log("[tasks/callback] кнопки задач: перенос / завершить");
}

module.exports = { registerTaskCallbackHandlers };
