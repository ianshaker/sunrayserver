// ============================================================================
// call-ai — обработка звонков: расшифровка (Google STT) + саммари (Gemini).
//
// Единая точка входа. server.js дергает только отсюда.
//
// Поток (pipeline):
//   Selectel скачал mp3 → POST /internal/recording-upload → Storage+БД (Render)
//     → STT (sync <60с / GCS longrunning) → transcript
//     → triggerSummary → Gemini / raw-short → Telegram (входящие)
//   safety-sweep редко добирает pending; CRM request-ai — force.
//
// Отдельный стек: call-ai/ask/ — CRM Q&A по AI-сводкам (POST /api/calls/ask).
// Факты дня для главной CRM — НЕ здесь: см. ../home-highlights/
// ============================================================================

const { startTranscriptionWorker, triggerTranscription } = require("./transcription");
const { startSummarizationWorker, triggerSummary } = require("./summarization");
const { setTelegramBot } = require("./telegramSummary");
const { askAboutCalls, registerAskRoute } = require("./ask");
const { registerRecordingUploadRoute } = require("./recordingIngest");

function startCallAiWorkers() {
  startTranscriptionWorker();
  startSummarizationWorker();
}

module.exports = {
  startCallAiWorkers,
  startTranscriptionWorker,
  triggerTranscription,
  startSummarizationWorker,
  triggerSummary,
  setTelegramBot,
  askAboutCalls,
  registerAskRoute,
  registerRecordingUploadRoute,
};
