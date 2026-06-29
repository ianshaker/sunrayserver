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
  if (draft.extraAssigneeName) lines.push(`Исполнитель: ${draft.extraAssigneeName}`);
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
  if (draft.extraAssigneeName) lines.push(`Исполнитель: ${draft.extraAssigneeName}`);
  return lines.join("\n");
}

function buildCancelledMessage() {
  return "❌ Отменено. Задача не создана — пришлите запрос заново при необходимости.";
}

/** Отказ без диалога: одна причина + просьба прислать задачу заново. */
function buildRejectedMessage(reason) {
  const lines = [
    "❌ Задача не создана.",
    "",
    `Причина: ${reason}`,
    "",
    "Отправьте задачу заново одним сообщением с @ботом, например:",
    "«@SUNRAYY_bot напомни завтра в 10 утра позвонить клиенту»",
  ];
  return lines.join("\n");
}

module.exports = {
  buildPreviewMessage,
  buildCreatedMessage,
  buildCancelledMessage,
  buildRejectedMessage,
};
