// ============================================================================
// Извлечение контекста из reply_to_message.
// Текст/caption — используем напрямую.
// Голосовое — расшифровываем через Google STT (async).
// Остальные вложения без текста — игнорируем.
// ============================================================================

const { MAX_INPUT_CHARS } = require("./config");
const { transcribeVoice, labelTranscribeError } = require("./voiceTranscribe");

const UNSUPPORTED_LABELS = {
  video_note: "кружок",
  audio: "аудио",
  sticker: "стикер",
  animation: "GIF",
  photo: "фото",
  video: "видео",
  document: "файл",
  contact: "контакт",
  location: "геолокация",
  poll: "опрос",
  dice: "стикер-куб",
};

function detectUnsupportedKind(replyMsg) {
  if (!replyMsg) return null;
  for (const key of Object.keys(UNSUPPORTED_LABELS)) {
    if (replyMsg[key]) return key;
  }
  return null;
}

function labelUnsupportedKind(kind) {
  if (!kind || kind === "empty") return "сообщение без текста";
  return UNSUPPORTED_LABELS[kind] || "вложение без текста";
}

/**
 * @param {object|null|undefined} replyMsg — msg.reply_to_message
 * @param {object|null} bot — Telegram bot instance (нужен для голосовых)
 * @param {number} [maxChars]
 * @returns {Promise<{
 *   replyText: string|null,
 *   replyFrom: object|null,
 *   replyUnsupported: string|null,
 *   replyVoiceFailed: string|null,
 * }>}
 */
async function extractReplyContext(replyMsg, bot = null, maxChars = MAX_INPUT_CHARS) {
  if (!replyMsg || replyMsg.from?.is_bot) {
    return { replyText: null, replyFrom: null, replyUnsupported: null, replyVoiceFailed: null };
  }

  const replyText =
    (replyMsg.text || replyMsg.caption || "").trim().slice(0, maxChars) || null;

  if (replyText) {
    return {
      replyText,
      replyFrom: replyMsg.from,
      replyUnsupported: null,
      replyVoiceFailed: null,
    };
  }

  // Голосовое — пробуем расшифровать
  if (replyMsg.voice) {
    const { transcript, error } = await transcribeVoice(replyMsg.voice, bot);
    if (transcript) {
      console.log("[replyExtract] голосовое расшифровано, длина:", transcript.length);
      return {
        replyText: transcript.slice(0, maxChars),
        replyFrom: replyMsg.from,
        replyUnsupported: null,
        replyVoiceFailed: null,
      };
    }
    const label = labelTranscribeError(error);
    console.log(`[replyExtract] голосовое не расшифровано: ${label}`);
    return {
      replyText: null,
      replyFrom: null,
      replyUnsupported: null,
      replyVoiceFailed: label,
    };
  }

  // Остальные вложения без текста
  const kind = detectUnsupportedKind(replyMsg) || "empty";
  return {
    replyText: null,
    replyFrom: null,
    replyUnsupported: kind,
    replyVoiceFailed: null,
  };
}

module.exports = {
  extractReplyContext,
  labelUnsupportedKind,
  detectUnsupportedKind,
};
