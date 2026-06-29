// ============================================================================
// Тексты сообщений для создания задачи из Telegram.
// ============================================================================

function buildPreviewMessage(draft) {
  const lines = [
    "📝 Создать задачу?",
    "---",
    `Название: ${draft.title}`,
  ];
  if (draft.description) lines.push(`Описание: ${draft.description}`);
  lines.push(`Напомнить: ${draft.dueDateHuman}`);
  lines.push("---");
  lines.push("Нажмите «Сохранить» или «Отменить».");
  return lines.join("\n");
}

function buildCreatedMessage(taskNumber, draft) {
  const lines = [
    `✅ Создал задачу #${taskNumber}`,
    "---",
    `Название: ${draft.title}`,
  ];
  if (draft.description) lines.push(`Описание: ${draft.description}`);
  lines.push(`Напомню: ${draft.dueDateHuman}`);
  return lines.join("\n");
}

function buildCancelledMessage() {
  return "❌ Отменено. Задача не создана — пришлите запрос заново при необходимости.";
}

module.exports = {
  buildPreviewMessage,
  buildCreatedMessage,
  buildCancelledMessage,
};
