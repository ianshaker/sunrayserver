// ============================================================================
// Настройки отдела «факты дня» для главной плитки CRM.
// Не смешивать с call-ai (STT/саммари звонков).
// ============================================================================

module.exports = {
  // 01:00 UTC = 04:00 MSK (node-schedule 6-field cron)
  CRON_PATTERN: process.env.DAILY_HIGHLIGHTS_CRON || "0 0 1 * * *",
  TOP_N: 5,
  MAX_CHARS: 220, // situation → home_daily_highlights.text
  MAX_COMMENT_CHARS: 140, // bot_comment
  SETUP_SECRET:
    process.env.DAILY_HIGHLIGHTS_SETUP_SECRET ||
    process.env.TELEGRAM_SETUP_SECRET ||
    "",
  VERTEX_LOCATION: process.env.VERTEX_LOCATION || "us-central1",
  MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
};
