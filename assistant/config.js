// ============================================================================
// assistant — конфигурация AI-роутера входящих сообщений Telegram.
// ============================================================================

const { SUMMARY } = require("../call-ai/config");

module.exports = {
  GEMINI_MODEL: SUMMARY.MODEL,
  VERTEX_LOCATION: SUMMARY.VERTEX_LOCATION,
  CONFIDENCE_THRESHOLD: parseFloat(process.env.ASSISTANT_CONFIDENCE_THRESHOLD || "0.5"),
  MAX_INPUT_CHARS: parseInt(process.env.ASSISTANT_MAX_INPUT_CHARS || "2000", 10),
  /** К кому обращаться за подключением чата / прав бота. */
  ADMIN_TELEGRAM_USERNAME: (process.env.ASSISTANT_ADMIN_USERNAME || "sunsseo").replace(/^@/, ""),
  REPLIES: {
    UNKNOWN:
      "Не понял запрос. Попробуйте переформулировать или уточнить, что нужно сделать.",
    ERROR: "Не удалось обработать сообщение. Попробуйте позже.",
    AI_DISABLED: "AI-ассистент временно недоступен.",
  },
};

function buildPermissionReply(kind, adminUsername) {
  const admin = `@${adminUsername}`;
  const messages = {
    no_registry: [
      "🚫 Бот не подключён к этому чату.",
      "",
      `Обратитесь к ${admin} — добавит чат и нужные права.`,
    ].join("\n"),
    no_permissions: [
      "🚫 В этом чате у бота нет разрешений.",
      "",
      `Обратитесь к ${admin} — настроит права.`,
    ].join("\n"),
    no_create: [
      "🚫 В этом чате нельзя создавать задачи и напоминания через бота.",
      "",
      `Обратитесь к ${admin} — подключит право «создание задач».`,
    ].join("\n"),
    no_manage: [
      "🚫 В этом чате нельзя изменять задачи (перенос, edit, завершение, отмена).",
      "",
      `Обратитесь к ${admin} — выдаст боту право «управление задачами».`,
    ].join("\n"),
  };
  return messages[kind] || null;
}

module.exports.buildPermissionReply = buildPermissionReply;
