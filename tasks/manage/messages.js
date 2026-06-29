// ============================================================================
// Тексты ответов для управления задачами из Telegram.
// Без уточняющих вопросов: при нехватке данных — отказ + просьба вызвать заново.
// ============================================================================

const { buildAddAssigneeLine, buildAddedAssigneeLine } = require("../assigneeMention");

const ACTION_VERB = {
  complete: "завершить",
  cancel: "отменить",
  delete: "удалить",
  reschedule: "перенести",
  edit: "изменить",
};

const ACTION_NOUN = {
  complete: "завершения",
  cancel: "отмены",
  delete: "удаления",
  reschedule: "переноса",
  edit: "изменения",
};

const STATUS_LABEL = {
  completed: "уже завершена",
  cancelled: "уже отменена",
};

function verb(action) {
  return ACTION_VERB[action] || "изменить";
}

const PREVIEW_HEADING = {
  complete: "✅ Завершить задачу",
  cancel: "❌ Отменить задачу",
  delete: "🗑 Удалить задачу навсегда",
  reschedule: "⏰ Перенести задачу",
  edit: "✏️ Изменить задачу",
};

function buildPreviewMessage(draft) {
  const heading = PREVIEW_HEADING[draft.action] || "Изменить задачу";
  const lines = [
    `${heading} #${draft.taskNumber}?`,
    "---",
    `Название: ${draft.taskTitle || "—"}`,
  ];

  let parseMode;

  if (draft.action === "reschedule") {
    if (draft.currentDueHuman) lines.push(`Сейчас: ${draft.currentDueHuman}`);
    lines.push(`Новый дедлайн: ${draft.dueDateHuman || "не указано"}`);
  }

  if (draft.action === "edit") {
    if (draft.dueDateHuman) lines.push(`Новый дедлайн: ${draft.dueDateHuman}`);
    if (draft.extraAssigneeProfile) {
      const addLine = buildAddAssigneeLine(draft.extraAssigneeProfile);
      lines.push(addLine.text);
      parseMode = addLine.parseMode;
    }
    if (draft.descriptionAppend) {
      lines.push(`Дополнить описание: ${draft.descriptionAppend}`);
    }
  }

  if (draft.action === "delete") {
    lines.push("Задача будет удалена без архива — восстановить нельзя.");
  }

  lines.push("---");
  lines.push("Нажмите «Сохранить» или «Отменить».");
  return { text: lines.join("\n"), parseMode };
}

function buildPreviewDismissedMessage() {
  return "❌ Отменено. Действие не выполнено — пришлите команду заново при необходимости.";
}

function buildContextNotFoundMessage(action) {
  return [
    `🔍 Не нашёл активных задач, подходящих под ваш запрос.`,
    "",
    `Попробуйте уточнить название или укажите номер задачи:`,
    `«@SUNRAYY_bot ${verb(action)} задачу #17»`,
  ].join("\n");
}

function buildNoActiveTasksMessage() {
  return "ℹ️ Активных задач нет — нечего изменять.";
}

function buildAmbiguousMessage(candidates, action) {
  const list = candidates
    .map((c) => `• #${c.task_number} — ${c.title || "без названия"}`)
    .join("\n");
  return [
    `🔍 Нашёл несколько похожих задач — уточните, которую нужно ${verb(action)}:`,
    "",
    list,
    "",
    `Вызовите меня с номером задачи:`,
    `«@SUNRAYY_bot ${verb(action)} задачу #17»`,
  ].join("\n");
}

function buildNoNumberMessage(action) {
  const noun = ACTION_NOUN[action] || "действия";
  return [
    `❌ Не могу понять, какую задачу нужно ${verb(action)} — не указан номер.`,
    "",
    `Для ${noun} назовите номер задачи (например #17) и вызовите меня заново:`,
    `«@SUNRAYY_bot ${verb(action)} задачу #17»`,
  ].join("\n");
}

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

function buildDeletedMessage(task) {
  return `🗑 Задача #${task.task_number} удалена навсегда.\nНазвание: ${task.title || "—"}`;
}

function buildRescheduledMessage(task, dueDateHuman) {
  return [
    `⏰ Задача #${task.task_number} перенесена.`,
    `Название: ${task.title || "—"}`,
    `Новый дедлайн: ${dueDateHuman}`,
  ].join("\n");
}

function buildEditedMessage(task, draft) {
  const lines = [
    `✏️ Задача #${task.task_number} обновлена.`,
    `Название: ${task.title || "—"}`,
  ];

  let parseMode;

  if (draft.dueDateHuman) lines.push(`Дедлайн: ${draft.dueDateHuman}`);

  if (draft.extraAssigneeProfile) {
    const addedLine = buildAddedAssigneeLine(draft.extraAssigneeProfile);
    lines.push(addedLine.text);
    parseMode = addedLine.parseMode;
  }

  if (draft.descriptionAppend) {
    lines.push(`Дополнено описание: ${draft.descriptionAppend}`);
  }

  return { text: lines.join("\n"), parseMode };
}

module.exports = {
  buildPreviewMessage,
  buildPreviewDismissedMessage,
  buildContextNotFoundMessage,
  buildNoActiveTasksMessage,
  buildAmbiguousMessage,
  buildNoNumberMessage,
  buildRejectedMessage,
  buildNotFoundMessage,
  buildNotAllowedMessage,
  buildAlreadyClosedMessage,
  buildCompletedMessage,
  buildCancelledMessage,
  buildDeletedMessage,
  buildRescheduledMessage,
  buildEditedMessage,
};
