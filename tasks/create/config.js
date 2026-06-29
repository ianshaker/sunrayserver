// ============================================================================
// Создание задач из Telegram — настройки.
// ============================================================================

const { SUMMARY } = require("../../call-ai/config");

module.exports = {
  GEMINI_MODEL: SUMMARY.MODEL,
  VERTEX_LOCATION: SUMMARY.VERTEX_LOCATION,

  DEFAULT_PRIORITY: "medium",
  DEFAULT_STATUS: "pending",

  // Черновик задачи (между превью и нажатием «Сохранить»).
  DRAFT_TTL_MS: 60 * 60 * 1000, // 1 час

  // Префикс callback-кнопок превью.
  CALLBACK_PREFIX: "tc",
};
