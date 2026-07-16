// ============================================================================
// call-ai — обработка звонков: расшифровка (Google STT) + саммари (Gemini).
//
// Единая точка входа. server.js дергает только отсюда.
//
// Поток (pipeline):
//   запись готова (Selectel) → triggerTranscription → STT → transcript
//     → (цепочка) triggerSummary → Gemini → summary → Telegram (чат входящих)
//   fallback: оба воркера раз в минуту добирают очередь из БД.
//
// Отдельный стек: call-ai/ask/ — CRM Q&A по AI-сводкам (POST /api/calls/ask).
//
// Факты дня для главной CRM — НЕ здесь: см. ../home-highlights/
// ============================================================================

const { startTranscriptionWorker, triggerTranscription } = require("./transcription");
const { startSummarizationWorker, triggerSummary } = require("./summarization");
const { setTelegramBot } = require("./telegramSummary");
const { askAboutCalls, registerAskRoute } = require("./ask");

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
};
