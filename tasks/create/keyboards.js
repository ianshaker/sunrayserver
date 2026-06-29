// ============================================================================
// Inline-кнопки превью создаваемой задачи.
// ============================================================================

const { CALLBACK_PREFIX } = require("./config");

const CALLBACK_RE = new RegExp(`^${CALLBACK_PREFIX}:(save|cancel):([a-f0-9]+)$`);

function buildPreviewKeyboard(draftId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Сохранить", callback_data: `${CALLBACK_PREFIX}:save:${draftId}` },
        { text: "❌ Отменить", callback_data: `${CALLBACK_PREFIX}:cancel:${draftId}` },
      ],
    ],
  };
}

function parsePreviewCallback(data) {
  const match = String(data || "").match(CALLBACK_RE);
  if (!match) return null;
  return { action: match[1], draftId: match[2] };
}

module.exports = { buildPreviewKeyboard, parsePreviewCallback };
