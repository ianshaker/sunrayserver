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

  // --- Саммари нейро-сводок звонков (Gemini / Vertex AI) ---
  // Только call-ai (summary + ask по звонкам). НЕ трогаем чужие env:
  //   DAILY_HIGHLIGHTS_* | ASSISTANT_* | SCHEDULE_AI_* | TASKS_* |
  //   APPEALS_DEADLINES_* | LOADING_DEADLINES_* | GOOGLE_STT_MODEL
  //
  // Выбор модели (как у home-highlights):
  //   CALL_AI_GEMINI_MODEL      — id модели (дефолт: gemini-3-flash-preview, не Pro)
  //   CALL_AI_VERTEX_LOCATION   — endpoint (для Gemini 3 Flash — global)
  SUMMARY: {
    POLL_MS: 60000, // fallback poll (основной путь — цепочка после STT)
    BATCH_LIMIT: 3,
    STALE_MIN: 15,
    VERTEX_LOCATION: process.env.CALL_AI_VERTEX_LOCATION || "global",
    MODEL: process.env.CALL_AI_GEMINI_MODEL || "gemini-3-flash-preview",
    // Короче этого — Gemini не зовём: в summary/TG кладём сырой диалог.
    // Переопределение: SUMMARY_SHORT_TRANSCRIPT_MAX_CHARS.
    SHORT_TRANSCRIPT_MAX_CHARS: parseInt(
      process.env.SUMMARY_SHORT_TRANSCRIPT_MAX_CHARS || "200",
      10,
    ),
  },
};
