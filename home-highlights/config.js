// ============================================================================
// Настройки отдела «факты дня» для главной плитки CRM.
// Не смешивать с call-ai (STT/саммари звонков).
// ============================================================================

module.exports = {
  // 01:00 UTC = 04:00 MSK (node-schedule 6-field cron)
  CRON_PATTERN: process.env.DAILY_HIGHLIGHTS_CRON || "0 0 1 * * *",
  TOP_N: 5,
  // Мягкие ориентиры для промпта (сервер длину НЕ обрезает)
  MAX_CHARS: 220,
  MAX_COMMENT_CHARS: 140,
  SETUP_SECRET:
    process.env.DAILY_HIGHLIGHTS_SETUP_SECRET ||
    process.env.TELEGRAM_SETUP_SECRET ||
    "",
  // Только home-highlights. НЕ трогаем GEMINI_MODEL / VERTEX_LOCATION call-ai.
  // Gemini 3 Flash на Vertex — global endpoint.
  VERTEX_LOCATION: process.env.DAILY_HIGHLIGHTS_VERTEX_LOCATION || "global",
  MODEL: process.env.DAILY_HIGHLIGHTS_GEMINI_MODEL || "gemini-3-flash-preview",
};
