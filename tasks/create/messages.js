// ============================================================================
// Тексты сообщений для создания задачи из Telegram.
// ============================================================================

const { buildAssigneeLine } = require("../assigneeMention");

function buildPreviewMessage(draft) {
  const lines = [
    "📝 Создать задачу?",
    "---",
    `Название: ${draft.title}`,
  ];
  if (draft.description) lines.push(`Описание: ${draft.description}`);
  lines.push(`Напомнить: ${draft.dueDateHuman}`);

  let parseMode;
  if (draft.extraAssigneeProfile) {
    const assigneeLine = buildAssigneeLine(draft.extraAssigneeProfile);
    lines.push(assigneeLine.text);
    parseMode = assigneeLine.parseMode;
  }

  lines.push("---");
  lines.push("Нажмите «Сохранить» или «Отменить».");
  return { text: lines.join("\n"), parseMode };
}

function buildCreatedMessage(taskNumber, draft) {
  const lines = [
    `✅ Создал задачу #${taskNumber}`,
    "---",
    `Название: ${draft.title}`,
  ];
  if (draft.description) lines.push(`Описание: ${draft.description}`);
  lines.push(`Напомню: ${draft.dueDateHuman}`);

  let parseMode;
  if (draft.extraAssigneeProfile) {
    const assigneeLine = buildAssigneeLine(draft.extraAssigneeProfile);
    lines.push(assigneeLine.text);
    parseMode = assigneeLine.parseMode;
  }

  return { text: lines.join("\n"), parseMode };
}

function buildCancelledMessage() {
  return { text: "❌ Отменено. Задача не создана — пришлите запрос заново при необходимости." };
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
  return { text: lines.join("\n") };
}

module.exports = {
  buildPreviewMessage,
  buildCreatedMessage,
  buildCancelledMessage,
  buildRejectedMessage,
};
