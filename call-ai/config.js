// ============================================================================
// Настройки обработки звонков (расшифровка + саммари).
// Всё, что можно крутить через env или менять руками — здесь.
// ============================================================================

module.exports = {
  CALL_RECORDINGS_BUCKET: "call-recordings",

  // --- Расшифровка (Google Speech-to-Text) ---
  STT: {
    // Safety-sweep (не основной путь). Основной старт — /internal/recording-upload.
    POLL_MS: parseInt(process.env.GOOGLE_STT_SAFETY_POLL_MS || String(15 * 60 * 1000), 10),
    BATCH_LIMIT: 3,
    STALE_MIN: 15, // processing старше N мин → pending
    OP_TIMEOUT_MS: parseInt(process.env.GOOGLE_STT_OP_TIMEOUT_MS || String(20 * 60 * 1000), 10),
    LONGRUNNING_POLL_MS: parseInt(process.env.GOOGLE_STT_LONGRUNNING_POLL_MS || "5000", 10),
    // Sync recognize (inline) — лимит Google ~60 с / 10 MB.
    SYNC_MAX_SECONDS: parseInt(process.env.GOOGLE_STT_SYNC_MAX_SECONDS || "60", 10),
    LANGUAGE_CODE: "ru-RU",
    MODEL: process.env.GOOGLE_STT_MODEL || "telephony",
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
