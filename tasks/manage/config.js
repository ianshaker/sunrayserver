// ============================================================================
// Управление задачами из Telegram (отмена / завершение / перенос) — настройки.
// ============================================================================

const { SUMMARY } = require("../../call-ai/config");

module.exports = {
  GEMINI_MODEL: SUMMARY.MODEL,
  VERTEX_LOCATION: SUMMARY.VERTEX_LOCATION,

  /** Действия, которые понимает парсер. */
  ACTIONS: Object.freeze(["complete", "cancel", "reschedule"]),

  DRAFT_TTL_MS: 60 * 60 * 1000, // 1 час
  CALLBACK_PREFIX: "tm",
};
