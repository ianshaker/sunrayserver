const { TIMEZONE } = require("./config");

const PRIORITY_LABELS = {
  urgent: "Срочно",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const STATUS_LABELS = {
  pending: "Ожидает",
  in_progress: "В работе",
  completed: "Завершено",
  cancelled: "Отменено",
};

/** ISO / timestamp → «ДД.MM.YYYY, ЧЧ:ММ» по Москве. */
function formatDateTime(dateString) {
  if (!dateString) return "Не указано";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Не указано";

  return date.toLocaleString("ru-RU", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPriorityLabel(priority) {
  const label = PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium;
  if (priority === "urgent") return `🔥 ${label}`;
  return label;
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.pending;
}

function formatOptionalBlock(label, value) {
  const text = (value || "").trim();
  if (!text) return null;
  return `${label}: ${text}`;
}

module.exports = {
  formatDateTime,
  getPriorityLabel,
  getStatusLabel,
  formatOptionalBlock,
};
