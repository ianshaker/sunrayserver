// ============================================================================
// Тексты ответов для управления задачами из Telegram.
// Без уточняющих вопросов: при нехватке данных — отказ + просьба вызвать заново.
// ============================================================================

const ACTION_VERB = {
  complete: "завершить",
  cancel: "отменить",
  reschedule: "перенести",
};

const ACTION_NOUN = {
  complete: "завершения",
  cancel: "отмены",
  reschedule: "переноса",
};

const STATUS_LABEL = {
  completed: "уже завершена",
  cancelled: "уже отменена",
};

function verb(action) {
  return ACTION_VERB[action] || "изменить";
}

/** Номер не назван — отказ без диалога, просьба вызвать заново с номером. */
function buildNoNumberMessage(action) {
  const noun = ACTION_NOUN[action] || "действия";
  return [
    `❌ Не могу понять, какую задачу нужно ${verb(action)} — не указан номер.`,
    "",
    `Для ${noun} назовите номер задачи (например #17) и вызовите меня заново:`,
    `«@SUNRAYY_bot ${verb(action)} задачу #17»`,
  ].join("\n");
}

/** Отказ от парсера (например, неоднозначное время переноса). */
function buildRejectedMessage(reason, action) {
  const lines = [
    "❌ Команда не выполнена.",
    "",
    `Причина: ${reason}`,
    "",
    "Уточните и вызовите меня заново одним сообщением с @ботом, например:",
    `«@SUNRAYY_bot ${verb(action)} задачу #17 на завтра в 10 утра»`,
  ];
  return lines.join("\n");
}

function buildNotFoundMessage(taskNumber) {
  return `❌ Задача #${taskNumber} не найдена. Проверьте номер и вызовите меня заново.`;
}

function buildNotAllowedMessage(taskNumber) {
  return `🚫 Менять задачу #${taskNumber} могут только её участники (автор или исполнитель).`;
}

function buildAlreadyClosedMessage(task) {
  const label = STATUS_LABEL[task.status] || "уже закрыта";
  return `ℹ️ Задача #${task.task_number} ${label} — действие не требуется.`;
}

function buildCompletedMessage(task) {
  return `✅ Задача #${task.task_number} завершена.\nНазвание: ${task.title || "—"}`;
}

function buildCancelledMessage(task) {
  return `❌ Задача #${task.task_number} отменена.\nНазвание: ${task.title || "—"}`;
}

function buildRescheduledMessage(task, dueDateHuman) {
  return [
    `⏰ Задача #${task.task_number} перенесена.`,
    `Название: ${task.title || "—"}`,
    `Новый дедлайн: ${dueDateHuman}`,
  ].join("\n");
}

module.exports = {
  buildNoNumberMessage,
  buildRejectedMessage,
  buildNotFoundMessage,
  buildNotAllowedMessage,
  buildAlreadyClosedMessage,
  buildCompletedMessage,
  buildCancelledMessage,
  buildRescheduledMessage,
};
