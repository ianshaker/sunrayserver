const {
  formatDateTime,
  getPriorityLabel,
  getStatusLabel,
  formatOptionalBlock,
} = require("./formatters");
const { buildForLine } = require("./assigneeMention");

function formatTaskNumber(task) {
  if (task?.task_number == null) return "";
  return ` #${task.task_number}`;
}

function buildTaskCreatedMessage(task, assignedBy) {
  const lines = [
    `ЗАДАЧА${formatTaskNumber(task)} от ${formatDateTime(task.created_at)}`,
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
    `ЗАДАЧА${formatTaskNumber(task)} ОБНОВЛЕНА · ${formatDateTime(new Date().toISOString())}`,
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
    `ЗАДАЧА${formatTaskNumber(task)} ЗАВЕРШЕНА · ${formatDateTime(new Date().toISOString())}`,
    `Название: ${task.title || "—"}`,
    `Выполнили: ${executors || "—"}`,
    `Автор: ${assignedBy.full_name || "—"}`,
  ];

  return lines.join("\n");
}

function buildTaskDueReminderMessage(task, assigneeProfile) {
  const forLine = buildForLine(assigneeProfile);
  const numPrefix = task?.task_number != null ? `#${task.task_number} ` : "";
  const deadline = task.due_date ? formatDateTime(task.due_date) : "Не указан";

  return {
    text: [
      `⏰ ${numPrefix}ДЕДЛАЙН ${deadline}`,
      forLine.text,
      "---",
      `Название: ${task.title || "—"}`,
    ].join("\n"),
    parseMode: forLine.parseMode,
  };
}

module.exports = {
  buildTaskCreatedMessage,
  buildTaskUpdatedMessage,
  buildTaskCompletedMessage,
  buildTaskDueReminderMessage,
};
