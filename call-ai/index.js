// ============================================================================
// call-ai — обработка звонков: расшифровка (Google STT) + саммари (Gemini).
//
// Единая точка входа. server.js дергает только отсюда.
//
// Поток:
//   запись готова (Selectel) → triggerTranscription → STT → transcript
//     → (цепочка) triggerSummary → Gemini → summary
//   fallback: оба воркера раз в минуту добирают очередь из БД.
// ============================================================================

const { startTranscriptionWorker, triggerTranscription } = require("./transcription");
const { startSummarizationWorker, triggerSummary } = require("./summarization");

// Запустить оба фоновых воркера.
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
};
