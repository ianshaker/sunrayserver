const { formatDateTime } = require("../formatters");

const LOG_MARKER = "🤖 AI-ассистент:";

function buildReminderLogLine(sentAtIso) {
  return `\n\n— ${LOG_MARKER} напоминание отправлено ${formatDateTime(sentAtIso)} (МСК)`;
}

function appendReminderToDescription(description, sentAtIso) {
  return `${(description || "").trimEnd()}${buildReminderLogLine(sentAtIso)}`;
}

/** Убираем служебные строки лога из текста для TG (чтобы не раздувать сообщение). */
function stripAiReminderLogs(description) {
  if (!description) return "";
  return description
    .split("\n")
    .filter((line) => !line.includes(LOG_MARKER))
    .join("\n")
    .trim();
}

module.exports = {
  LOG_MARKER,
  buildReminderLogLine,
  appendReminderToDescription,
  stripAiReminderLogs,
};
