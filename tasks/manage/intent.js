// ============================================================================
// Интент: управление существующей задачей из Telegram — завершить / отменить /
// перенести / редактировать.
//
// Две ветки:
//   A — номер задачи назван явно (#17, «задачу 17»)  → fetchByNumber → превью
//   B — номер не назван, задача описана словами       → contextSearch → превью
//
// Везде финал: превью с кнопками «Сохранить / Отменить» (callbacks.js).
// ============================================================================

const { PERMISSIONS } = require("../../lib/telegramBotChats");
const { sendText } = require("../../assistant/reply");
const { getTelegramBot } = require("../../tgwebhook/bot");
const { ACTIVE_TASK_STATUSES } = require("../config");
const { resolveTaskActionPermission } = require("../superUsers");
const { fetchTaskByNumberAny } = require("../taskActions");
const { formatMskHuman } = require("../create/time");
const { getRoster } = require("../create/assigneeRoster");
const { parseManageMessage } = require("./parser");
const { findTaskByContext } = require("./contextSearch");
const { createDraft } = require("./draft");
const { buildPreviewKeyboard } = require("./keyboards");
const { applyReplyContext } = require("./replyContext");
const {
  buildPreviewMessage,
  buildRejectedMessage,
  buildNotFoundMessage,
  buildNotAllowedMessage,
  buildAlreadyClosedMessage,
  buildContextNotFoundMessage,
  buildNoActiveTasksMessage,
  buildAmbiguousMessage,
} = require("./messages");

async function sendPreview(bot, chatId, task, parsed, authorProfileId, extraAssigneeProfile) {
  const needsDueHuman =
    parsed.action === "reschedule" || (parsed.action === "edit" && parsed.dueDateUtc);

  const draftData = {
    chatId,
    authorProfileId,
    action: parsed.action,
    taskId: task.id,
    taskNumber: task.task_number,
    taskTitle: task.title,
    dueDateUtc: parsed.dueDateUtc || null,
    dueDateHuman: needsDueHuman && parsed.dueDateUtc ? formatMskHuman(parsed.dueDateUtc) : null,
    currentDueHuman: task.due_date ? formatMskHuman(task.due_date) : null,
    extraAssigneeId: parsed.extraAssigneeId || null,
    extraAssigneeProfile: extraAssigneeProfile || null,
    descriptionAppend: parsed.descriptionAppend || null,
  };
  const draftId = createDraft(draftData);

  const preview = buildPreviewMessage(draftData);
  await bot.sendMessage(chatId, preview.text, {
    disable_web_page_preview: true,
    reply_markup: buildPreviewKeyboard(draftId),
    ...(preview.parseMode ? { parse_mode: preview.parseMode } : {}),
  });

  return draftId;
}

function checkAccess(task, profileId) {
  return resolveTaskActionPermission(task, profileId);
}

async function handle(ctx) {
  const { chatId, text, replyText, replyFrom, profileId, msg } = ctx;

  console.log(
    `[tasks/manage] старт chat=${chatId} profile=${profileId || "null"} ` +
      `tgUser=${msg?.from?.id} text="${text.slice(0, 100)}"` +
      (replyText ? ` replyCtx="${replyText.slice(0, 60)}"` : ""),
  );

  if (!profileId) {
    await sendText(
      chatId,
      "Вы не зарегистрированы в системе менеджеров — действие не выполнено. Обратитесь к администратору.",
    );
    return;
  }

  let parsed;
  try {
    parsed = await parseManageMessage(text, { replyText });
    parsed = await applyReplyContext(parsed, { replyText, replyFrom });
    console.log(
      `[tasks/manage] parse → status=${parsed.status} action=${parsed.action || "?"} ` +
        `num=${parsed.taskNumber ?? "null"}` +
        (parsed.descriptionAppend ? " descAppend=yes" : "") +
        (parsed.reason ? ` reason="${parsed.reason}"` : "") +
        (parsed.error ? ` err=${parsed.error}` : ""),
    );
  } catch (error) {
    console.error("[tasks/manage] парсинг упал:", error.message);
    await sendText(chatId, "Не удалось обработать команду. Попробуйте позже.");
    return;
  }

  if (parsed.status === "error") {
    await sendText(
      chatId,
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать команду. Сформулируйте иначе и вызовите меня заново.",
    );
    return;
  }

  if (parsed.status === "rejected") {
    await sendText(chatId, buildRejectedMessage(parsed.reason, parsed.action));
    return;
  }

  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[tasks/manage] нет telegramBot для превью");
    await sendText(chatId, "Не удалось показать подтверждение. Попробуйте позже.");
    return;
  }

  let task;

  if (parsed.taskNumber != null) {
    console.log(`[tasks/manage] ветка A: по номеру #${parsed.taskNumber}`);
    try {
      task = await fetchTaskByNumberAny(parsed.taskNumber);
    } catch (error) {
      console.error("[tasks/manage] выборка задачи:", error.message);
      await sendText(chatId, "Не удалось получить задачу. Попробуйте позже.");
      return;
    }

    if (!task) {
      await sendText(chatId, buildNotFoundMessage(parsed.taskNumber));
      return;
    }
  } else {
    console.log(`[tasks/manage] ветка B: контекстный поиск (action=${parsed.action})`);

    let contextResult;
    try {
      contextResult = await findTaskByContext(text, parsed.action, { replyText });
    } catch (error) {
      console.error("[tasks/manage] контекстный поиск упал:", error.message);
      await sendText(chatId, "Не удалось выполнить поиск задачи. Попробуйте позже.");
      return;
    }

    console.log(`[tasks/manage] контекст → status=${contextResult.status}`);

    if (contextResult.status === "no_tasks") {
      await sendText(chatId, buildNoActiveTasksMessage());
      return;
    }
    if (contextResult.status === "not_found") {
      await sendText(chatId, buildContextNotFoundMessage(parsed.action));
      return;
    }
    if (contextResult.status === "ambiguous") {
      await sendText(chatId, buildAmbiguousMessage(contextResult.candidates, parsed.action));
      return;
    }
    if (contextResult.status === "error") {
      await sendText(chatId, "Не удалось выполнить поиск задачи. Попробуйте позже.");
      return;
    }

    task = contextResult.task;
  }

  const access = checkAccess(task, profileId);
  if (!access.allowed) {
    console.log(`[tasks/manage] нет прав: profile=${profileId} task=#${task.task_number}`);
    await sendText(chatId, buildNotAllowedMessage(task.task_number));
    return;
  }

  if (!ACTIVE_TASK_STATUSES.includes(task.status) || task._source === "archive") {
    await sendText(chatId, buildAlreadyClosedMessage(task));
    return;
  }

  let extraAssigneeProfile = null;
  if (parsed.extraAssigneeId) {
    const roster = await getRoster();
    extraAssigneeProfile = roster.find((p) => p.id === parsed.extraAssigneeId) || null;
  }

  const draftId = await sendPreview(bot, chatId, task, parsed, profileId, extraAssigneeProfile);
  console.log(
    `[tasks/manage] превью: chat ${chatId}, draft ${draftId}, ${parsed.action} #${task.task_number}`,
  );
}

module.exports = {
  name: "task_manage",
  permission: PERMISSIONS.TASK_ACTIONS,
  title: "Управление существующей задачей",
  description:
    "Пользователь просит ДЕЙСТВИЕ над УЖЕ существующей задачей: завершить (→ архив), отменить (→ архив), удалить навсегда (без архива), перенести срок, или изменить (дедлайн + исполнитель + описание). По номеру (#17) или по описанию («задачу про слонов»). НЕ создание новой задачи.",
  examples: [
    "Заверши задачу #17",
    "Отмени задачу 20",
    "Удали задачу 5",
    "Перенеси задачу 12 на завтра в 10 утра",
    "Перенеси задачу 22 на завтра в 10 и добавь Гену",
    "Добавь в задачу 22: я ещё позвоню клиентке Елене",
    "Закрой задачу про звонок Татьяне",
    "Измени задачу где надо купить 5 слонов — добавь Глеба",
  ],
  handle,
};
