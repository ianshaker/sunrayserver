const {
  formatDateTime,
  getPriorityLabel,
  getStatusLabel,
  formatOptionalBlock,
} = require("./formatters");
const { stripAiReminderLogs } = require("./reminder/descriptionLog");

function buildTaskCreatedMessage(task, assignedBy) {
  const lines = [
    `ЗАДАЧА от ${formatDateTime(task.created_at)}`,
    `От: ${assignedBy.full_name || "—"}`,
    "---",
    `Название: ${task.title || "—"}`,
  ];

  const description = formatOptionalBlock("Описание", task.description);
  if (description) lines.push(description);

  lines.push(`Приоритет: ${getPriorityLabel(task.priority)}`);
  lines.push("---");
  lines.push(
    `Выполнить до ${task.due_date ? formatDateTime(task.due_date) : "Не указан"}`,
  );

  return lines.join("\n");
}

function buildTaskUpdatedMessage(task, assignedBy) {
  const lines = [
    `ЗАДАЧА ОБНОВЛЕНА · ${formatDateTime(new Date().toISOString())}`,
    `От: ${assignedBy.full_name || "—"}`,
    "---",
    `Название: ${task.title || "—"}`,
  ];

  const description = formatOptionalBlock("Описание", task.description);
  if (description) lines.push(description);

  lines.push(`Приоритет: ${getPriorityLabel(task.priority)}`);
  lines.push(`Статус: ${getStatusLabel(task.status)}`);
  lines.push("---");
  lines.push(
    `Выполнить до ${task.due_date ? formatDateTime(task.due_date) : "Не указан"}`,
  );

  return lines.join("\n");
}

function buildTaskCompletedMessage(task, assignees, assignedBy) {
  const executors = assignees
    .map((a) => a.full_name)
    .filter(Boolean)
    .join(", ");

  const lines = [
    `ЗАДАЧА ЗАВЕРШЕНА · ${formatDateTime(new Date().toISOString())}`,
    `Название: ${task.title || "—"}`,
    `Выполнили: ${executors || "—"}`,
    `Автор: ${assignedBy.full_name || "—"}`,
  ];

  return lines.join("\n");
}

function buildTaskDueReminderMessage(task, assigneeProfile) {
  const assigneeName = assigneeProfile?.full_name || "—";

  const lines = [
    "⏰ НАПОМИНАНИЕ О ДЕДЛАЙНЕ",
    `Для: ${assigneeName}`,
    "---",
    `Название: ${task.title || "—"}`,
  ];

  const cleanDescription = stripAiReminderLogs(task.description);
  const description = formatOptionalBlock("Описание", cleanDescription);
  if (description) lines.push(description);

  lines.push(`Приоритет: ${getPriorityLabel(task.priority)}`);
  lines.push(`Статус: ${getStatusLabel(task.status)}`);
  lines.push("---");
  lines.push(`Дедлайн: ${formatDateTime(task.due_date)}`);

  return lines.join("\n");
}

module.exports = {
  buildTaskCreatedMessage,
  buildTaskUpdatedMessage,
  buildTaskCompletedMessage,
  buildTaskDueReminderMessage,
};
