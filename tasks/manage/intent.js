// ============================================================================
// Интент: управление существующей задачей из Telegram — завершить / отменить /
// перенести.
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
const { parseManageMessage } = require("./parser");
const { findTaskByContext } = require("./contextSearch");
const { createDraft } = require("./draft");
const { buildPreviewKeyboard } = require("./keyboards");
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

// ─── общие утилиты ──────────────────────────────────────────────────────────

async function sendPreview(bot, chatId, task, parsedAction, parsedDueDateUtc, authorProfileId) {
  const draftData = {
    chatId,
    authorProfileId,
    action: parsedAction,
    taskId: task.id,
    taskNumber: task.task_number,
    taskTitle: task.title,
    dueDateUtc: parsedDueDateUtc || null,
    dueDateHuman: parsedAction === "reschedule" ? formatMskHuman(parsedDueDateUtc) : null,
    currentDueHuman: task.due_date ? formatMskHuman(task.due_date) : null,
  };
  const draftId = createDraft(draftData);

  await bot.sendMessage(chatId, buildPreviewMessage(draftData), {
    disable_web_page_preview: true,
    reply_markup: buildPreviewKeyboard(draftId),
  });

  return draftId;
}

function checkAccess(task, profileId) {
  return resolveTaskActionPermission(task, profileId);
}

// ─── handle ─────────────────────────────────────────────────────────────────

async function handle(ctx) {
  const { chatId, text, profileId, msg } = ctx;

  console.log(
    `[tasks/manage] старт chat=${chatId} profile=${profileId || "null"} ` +
      `tgUser=${msg?.from?.id} text="${text.slice(0, 100)}"`,
  );

  if (!profileId) {
    await sendText(
      chatId,
      "Вы не зарегистрированы в системе менеджеров — действие не выполнено. Обратитесь к администратору.",
    );
    return;
  }

  // ── Этап 1: парсим действие, номер, время (fast-path или Gemini) ──────────

  let parsed;
  try {
    parsed = await parseManageMessage(text);
    console.log(
      `[tasks/manage] parse → status=${parsed.status} action=${parsed.action || "?"} ` +
        `num=${parsed.taskNumber ?? "null"}` +
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

  // ── Этап 2: получаем задачу (Ветка A — по номеру, Ветка B — по контексту) ─

  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[tasks/manage] нет telegramBot для превью");
    await sendText(chatId, "Не удалось показать подтверждение. Попробуйте позже.");
    return;
  }

  let task;

  if (parsed.taskNumber != null) {
    // ── Ветка A: номер указан ────────────────────────────────────────────────
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
    // ── Ветка B: поиск по контексту ──────────────────────────────────────────
    console.log(`[tasks/manage] ветка B: контекстный поиск (action=${parsed.action})`);

    let contextResult;
    try {
      contextResult = await findTaskByContext(text, parsed.action);
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

  // ── Этап 3: проверка прав и статуса (одинакова для обеих веток) ────────────

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

  // ── Этап 4: превью с кнопками «Сохранить / Отменить» ─────────────────────

  const draftId = await sendPreview(bot, chatId, task, parsed.action, parsed.dueDateUtc, profileId);
  console.log(
    `[tasks/manage] превью: chat ${chatId}, draft ${draftId}, ${parsed.action} #${task.task_number}`,
  );
}

module.exports = {
  name: "task_manage",
  permission: PERMISSIONS.TASK_ACTIONS,
  title: "Управление существующей задачей",
  description:
    "Пользователь просит ДЕЙСТВИЕ над УЖЕ существующей задачей: завершить (→ архив), отменить (→ архив), удалить навсегда (без архива), или перенести срок. По номеру (#17) или по описанию («задачу про слонов»). НЕ создание новой задачи.",
  examples: [
    "Заверши задачу #17",
    "Отмени задачу 20",
    "Удали задачу 5",
    "Перенеси задачу 12 на завтра в 10 утра",
    "Закрой задачу про звонок Татьяне",
    "Отмени задачу где надо купить 5 слонов",
    "Перенеси задачу по замеру у Ивановых на пятницу в 14:00",
  ],
  handle,
};
