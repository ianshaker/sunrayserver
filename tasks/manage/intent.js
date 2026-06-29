// ============================================================================
// Интент: управление существующей задачей из Telegram — завершить / отменить /
// перенести ПО НОМЕРУ.
//
// Поток: оркестратор → этот intent → парсинг Gemini → действие по номеру.
// Поиска по содержанию ПОКА НЕТ (затравка на будущее): если номер не назван —
// отказ без уточнений, просьба вызвать заново с номером.
// ============================================================================

const { PERMISSIONS } = require("../../lib/telegramBotChats");
const { sendText } = require("../../assistant/reply");
const { ACTIVE_TASK_STATUSES } = require("../config");
const { resolveTaskActionPermission } = require("../superUsers");
const {
  fetchTaskByNumberAny,
  completeTask,
  cancelTask,
  rescheduleTask,
} = require("../taskActions");
const { formatMskHuman } = require("../create/time");
const { parseManageMessage } = require("./parser");
const {
  buildNoNumberMessage,
  buildRejectedMessage,
  buildNotFoundMessage,
  buildNotAllowedMessage,
  buildAlreadyClosedMessage,
  buildCompletedMessage,
  buildCancelledMessage,
  buildRescheduledMessage,
} = require("./messages");

async function handle(ctx) {
  const { chatId, text, profileId, msg } = ctx;

  console.log(
    `[tasks/manage] старт chat=${chatId} profile=${profileId || "null"} ` +
      `tgUser=${msg?.from?.id} text="${text.slice(0, 100)}"`,
  );

  // Действовать может только зарегистрированный сотрудник.
  if (!profileId) {
    console.log(`[tasks/manage] отказ: профиль не найден для tg user ${msg?.from?.id}`);
    await sendText(
      chatId,
      "Вы не зарегистрированы в системе менеджеров — действие не выполнено. Обратитесь к администратору.",
    );
    return;
  }

  let parsed;
  try {
    parsed = await parseManageMessage(text);
    console.log(
      `[tasks/manage] parse → status=${parsed.status} action=${parsed.action || "?"} ` +
        `num=${parsed.taskNumber ?? "null"}` +
        (parsed.reason ? ` reason="${parsed.reason}"` : "") +
        (parsed.error ? ` error=${parsed.error}` : ""),
    );
  } catch (error) {
    console.error("[tasks/manage] парсинг упал:", error.message);
    await sendText(chatId, "Не удалось обработать команду. Попробуйте позже.");
    return;
  }

  if (parsed.status === "error") {
    const text =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать команду. Сформулируйте иначе и вызовите меня заново.";
    await sendText(chatId, text);
    return;
  }

  // Главное правило этапа без контекста: нет номера → отказ, вызвать заново.
  if (parsed.taskNumber == null) {
    console.log(`[tasks/manage] отказ: номер задачи не назван (action=${parsed.action})`);
    await sendText(chatId, buildNoNumberMessage(parsed.action));
    return;
  }

  if (parsed.status === "rejected") {
    console.log(`[tasks/manage] отказ парсера: ${parsed.reason}`);
    await sendText(chatId, buildRejectedMessage(parsed.reason, parsed.action));
    return;
  }

  let task;
  try {
    task = await fetchTaskByNumberAny(parsed.taskNumber);
  } catch (error) {
    console.error("[tasks/manage] выборка задачи упала:", error.message);
    await sendText(chatId, "Не удалось получить задачу. Попробуйте позже.");
    return;
  }

  if (!task) {
    await sendText(chatId, buildNotFoundMessage(parsed.taskNumber));
    return;
  }

  // Право действовать: участник задачи или повышенный доступ (как у TG-кнопок).
  const access = resolveTaskActionPermission(task, profileId);
  if (!access.allowed) {
    console.log(
      `[tasks/manage] нет прав: profile=${profileId} task=#${task.task_number}`,
    );
    await sendText(chatId, buildNotAllowedMessage(parsed.taskNumber));
    return;
  }

  if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
    await sendText(chatId, buildAlreadyClosedMessage(task));
    return;
  }

  try {
    if (parsed.action === "complete") {
      await completeTask(task.id);
      await sendText(chatId, buildCompletedMessage(task));
      console.log(`[tasks/manage] complete #${task.task_number} (chat ${chatId})`);
      return;
    }

    if (parsed.action === "cancel") {
      await cancelTask(task.id);
      await sendText(chatId, buildCancelledMessage(task));
      console.log(`[tasks/manage] cancel #${task.task_number} (chat ${chatId})`);
      return;
    }

    if (parsed.action === "reschedule") {
      await rescheduleTask(task.id, parsed.dueDateUtc);
      await sendText(
        chatId,
        buildRescheduledMessage(task, formatMskHuman(parsed.dueDateUtc)),
      );
      console.log(
        `[tasks/manage] reschedule #${task.task_number} → ${parsed.dueDateUtc} (chat ${chatId})`,
      );
      return;
    }
  } catch (error) {
    console.error(`[tasks/manage] ошибка действия ${parsed.action}:`, error.message);
    await sendText(chatId, "Не удалось выполнить действие. Попробуйте позже.");
  }
}

module.exports = {
  name: "task_manage",
  permission: PERMISSIONS.TASK_ACTIONS,
  title: "Управление существующей задачей",
  description:
    "Пользователь просит ДЕЙСТВИЕ над УЖЕ существующей задачей по её номеру: завершить/выполнить/закрыть, отменить/удалить, или перенести/сдвинуть срок. Обычно упоминается номер задачи (#17, «задачу 17»). Это НЕ создание новой задачи или напоминания.",
  examples: [
    "Заверши задачу #17",
    "Отмени задачу 20",
    "Удали задачу номер 5",
    "Перенеси задачу 12 на завтра в 10 утра",
    "Задача 8 выполнена, закрой её",
  ],
  handle,
};
