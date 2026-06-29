const { SNOOZE_PRESETS } = require("./taskActions");

/** Inline-кнопки под сообщением о задаче (создание + напоминание). */
function buildTaskActionKeyboard(taskNumber) {
  if (taskNumber == null) return undefined;

  return {
    inline_keyboard: [
      [
        { text: SNOOZE_PRESETS["10"].label, callback_data: `mt:10:${taskNumber}` },
        { text: SNOOZE_PRESETS["30"].label, callback_data: `mt:30:${taskNumber}` },
        { text: SNOOZE_PRESETS["1h"].label, callback_data: `mt:1h:${taskNumber}` },
      ],
      [
        { text: SNOOZE_PRESETS.tm.label, callback_data: `mt:tm:${taskNumber}` },
        { text: "Завершить", callback_data: `mt:ok:${taskNumber}` },
      ],
    ],
  };
}

module.exports = { buildTaskActionKeyboard };
