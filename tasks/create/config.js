// ============================================================================
// Создание задач из Telegram — настройки.
// ============================================================================

// Только tasks (create + manage делят TASKS_*). НЕ трогаем CALL_AI_* / другие отделы.
// Было через call-ai SUMMARY (= gemini-2.5-flash @ us-central1).
//   TASKS_GEMINI_MODEL / TASKS_VERTEX_LOCATION
module.exports = {
  GEMINI_MODEL: process.env.TASKS_GEMINI_MODEL || "gemini-2.5-flash",
  VERTEX_LOCATION: process.env.TASKS_VERTEX_LOCATION || "us-central1",

  DEFAULT_PRIORITY: "medium",
  DEFAULT_STATUS: "pending",

  // Черновик задачи (между превью и нажатием «Сохранить»).
  DRAFT_TTL_MS: 60 * 60 * 1000, // 1 час

  // Префикс callback-кнопок превью.
  CALLBACK_PREFIX: "tc",
};
