// ============================================================================
// Управление задачами из Telegram (отмена / завершение / перенос) — настройки.
// ============================================================================

// Только tasks (create + manage делят TASKS_*). НЕ трогаем CALL_AI_* / другие отделы.
// Было через call-ai SUMMARY (= gemini-2.5-flash @ us-central1).
//   TASKS_GEMINI_MODEL / TASKS_VERTEX_LOCATION
module.exports = {
  GEMINI_MODEL: process.env.TASKS_GEMINI_MODEL || "gemini-2.5-flash",
  VERTEX_LOCATION: process.env.TASKS_VERTEX_LOCATION || "us-central1",

  /** Действия, которые понимает парсер. */
  ACTIONS: Object.freeze(["complete", "cancel", "delete", "reschedule", "edit"]),

  DRAFT_TTL_MS: 60 * 60 * 1000, // 1 час
  CALLBACK_PREFIX: "tm",
};
