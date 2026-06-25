// ============================================================================
// Настройки обработки звонков (расшифровка + саммари).
// Всё, что можно крутить через env или менять руками — здесь.
// ============================================================================

module.exports = {
  CALL_RECORDINGS_BUCKET: "call-recordings",

  // --- Расшифровка (Google Speech-to-Text) ---
  STT: {
    POLL_MS: 60000, // fallback poll (основной путь — push от Selectel)
    BATCH_LIMIT: 3, // записей за цикл
    STALE_MIN: 15, // через сколько минут "processing" вернуть в pending
    OP_TIMEOUT_MS: 180000, // макс. ожидание ответа Google на одну запись
    LANGUAGE_CODE: "ru-RU",
    MODEL: process.env.GOOGLE_STT_MODEL || "latest_long",
  },

  // --- Саммари (Gemini / Vertex AI) ---
  SUMMARY: {
    POLL_MS: 60000, // fallback poll (основной путь — цепочка после STT)
    BATCH_LIMIT: 3,
    STALE_MIN: 15,
    // Agent Platform (июнь 2026): gemini-2.0-flash снят с regional endpoints.
    // Для us-central1: gemini-2.5-flash. Переопределение: GEMINI_MODEL, VERTEX_LOCATION.
    VERTEX_LOCATION: process.env.VERTEX_LOCATION || "us-central1",
    MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  },
};
