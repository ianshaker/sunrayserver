const schedule = require("node-schedule");
const { REMINDER_CRON_PATTERN } = require("../config");
const {
  fetchTasksDueForReminder,
  isReminderDue,
} = require("./queries");
const { processTaskReminder } = require("./processTask");

async function runDueReminderCheck(telegramBot) {
  const prefix = `[tasks/reminder ${new Date().toISOString()}]`;

  try {
    const candidates = await fetchTasksDueForReminder();
    const due = candidates.filter(isReminderDue);

    if (!due.length) {
      return;
    }

    console.log(`${prefix} к отправке: ${due.length} задач(и)`);

    for (const task of due) {
      try {
        await processTaskReminder(task, telegramBot);
      } catch (error) {
        console.error(
          `${prefix} ошибка задачи ${task.id}:`,
          error.message,
        );
      }
    }
  } catch (error) {
    console.error(`${prefix} ошибка poll:`, error.message);
  }
}

function startTaskReminderWorker(telegramBot) {
  schedule.scheduleJob(REMINDER_CRON_PATTERN, () => {
    runDueReminderCheck(telegramBot);
  });

  console.log(
    `[tasks/reminder] Cron запущен: ${REMINDER_CRON_PATTERN} (каждую минуту, повтор каждые 30 мин)`,
  );
}

module.exports = { startTaskReminderWorker, runDueReminderCheck };
