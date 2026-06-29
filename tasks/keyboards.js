/** Inline-кнопки под сообщением о задаче (создание + напоминание). */
function buildTaskActionKeyboard(taskNumber) {
  if (taskNumber == null) return undefined;

  return {
    inline_keyboard: [
      [
        {
          text: "⏰ Отложить на час",
          callback_data: `mt:sn:${taskNumber}`,
        },
        {
          text: "✅ Выполнено",
          callback_data: `mt:ok:${taskNumber}`,
        },
      ],
    ],
  };
}

module.exports = { buildTaskActionKeyboard };
