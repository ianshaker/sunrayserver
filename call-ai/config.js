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
    OP_TIMEOUT_MS: parseInt(process.env.GOOGLE_STT_OP_TIMEOUT_MS || String(20 * 60 * 1000), 10), // 20 мин
    LANGUAGE_CODE: "ru-RU",
    // telephony — для записей с телефонии (Mango 8 kHz). Переопределение: GOOGLE_STT_MODEL.
    MODEL: process.env.GOOGLE_STT_MODEL || "telephony",
    // Если задан — жёстко; иначе читаем из MP3-заголовка.
    SAMPLE_RATE_HERTZ: process.env.GOOGLE_STT_SAMPLE_RATE
      ? parseInt(process.env.GOOGLE_STT_SAMPLE_RATE, 10)
      : null,
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
