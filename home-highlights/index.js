// ============================================================================
// home-highlights — отдельный отдел: факты дня для главной плитки CRM.
//
// НЕ часть call-ai (STT / саммари / Telegram-сводок).
// Только: cron → Gemini(situation+bot_comment) → INSERT home_daily_highlights
// (новый batch_id каждый прогон; старые строки + replies не трогаем).
// CRM читает последний batch за вчера (МСК). Telegram-интентов у этого отдела нет.
//
// Подключение в server.js:
//   const { startHomeHighlightsWorker, registerHomeHighlightsRoutes } = require("./home-highlights");
//   startHomeHighlightsWorker();
//   registerHomeHighlightsRoutes(fastify);
// ============================================================================

const { startHomeHighlightsWorker } = require("./worker");
const { registerHomeHighlightsRoutes } = require("./routes");
const { generateDailyHighlights } = require("./generate");

module.exports = {
  startHomeHighlightsWorker,
  registerHomeHighlightsRoutes,
  generateDailyHighlights,
};
