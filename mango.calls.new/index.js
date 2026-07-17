// ============================================================================
// mango.calls.new — webhook Mango → Telegram + строка в mango_calls.
//
// Telegram: одна редактируемая карточка на звонок (callCard + renderCallCard).
// AI-сводка — отдельно, call-ai/telegramSummary.
//
//   const { handleMangoWebhook } = require("./mango.calls.new");
//
// НЕ путать с ../mango-calls/ (CRM admin API: delete / request-ai).
// handleMangoRecording — legacy export, в server.js не wired.
// ============================================================================

const { handleMangoWebhook } = require("./webhook");
const { handleMangoRecording } = require("./recording");

module.exports = { handleMangoWebhook, handleMangoRecording };
