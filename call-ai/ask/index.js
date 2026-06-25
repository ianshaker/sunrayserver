// ============================================================================
// call-ai/ask — семантический поиск по AI-сводкам звонков (CRM).
//
// Отдельный стек от pipeline STT → summary → Telegram.
// ============================================================================

const { askAboutCalls, fetchCallsWithSummaries } = require("./service");
const { registerAskRoute } = require("./routes");

module.exports = { askAboutCalls, fetchCallsWithSummaries, registerAskRoute };
