// ============================================================================
// assistant — конфигурация AI-роутера входящих сообщений Telegram.
// ============================================================================

const { SUMMARY } = require("../call-ai/config");

module.exports = {
  GEMINI_MODEL: SUMMARY.MODEL,
  VERTEX_LOCATION: SUMMARY.VERTEX_LOCATION,
  CONFIDENCE_THRESHOLD: parseFloat(process.env.ASSISTANT_CONFIDENCE_THRESHOLD || "0.5"),
  MAX_INPUT_CHARS: parseInt(process.env.ASSISTANT_MAX_INPUT_CHARS || "2000", 10),
  REPLIES: {
    UNKNOWN:
      "Не понял запрос. Попробуйте переформулировать или уточнить, что нужно сделать.",
    ERROR: "Не удалось обработать сообщение. Попробуйте позже.",
    AI_DISABLED: "AI-ассистент временно недоступен.",
  },
};
