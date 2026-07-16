// ============================================================================
// Воркер дедлайнов погрузки.
//
// Каждые 30 мин (9:00–20:00 MSK, или круглосуточно если DEADLINE_24_7):
//   1. Если есть активное неотвеченное уведомление — шлём ⏰-пинг (со сменой msg_id).
//   2. Иначе — берём следующее событие Погрузка с наступившим deadline+deadline_time (МСК)
//      и кидаем карточку.
// ============================================================================

const schedule = require("node-schedule");
const {
  DEADLINE_CRON_PATTERN,
  DEADLINE_24_7,
  MSK_OFFSET_HOURS,
  WORK_HOUR_START,
  WORK_HOUR_END,
} = require("./config");
const { getActiveDeadlineNotif, getNextDeadlineEvent, getMskTodayDate } = require("./queries");
const { sendDeadlineNotification, sendDeadlineReminder } = require("./notifier");

/**
 * Возвращает текущий час по Москве (UTC+3).
 */
function getMskHour() {
  const now = new Date();
  const msk = new Date(now.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000);
  return msk.getUTCHours();
}

async function runDeadlineCheck(bot) {
  const prefix = `[loading-deadlines/worker ${new Date().toISOString()}]`;

  if (!DEADLINE_24_7) {
    const hour = getMskHour();
    if (hour < WORK_HOUR_START || hour >= WORK_HOUR_END) {
      return;
    }
  }

  try {
    const active = await getActiveDeadlineNotif();
    if (active) {
      console.log(
        `${prefix} активное уведомление ${active.appeal_number} — отправляем напоминание`,
      );
      await sendDeadlineReminder(active, bot);
      return;
    }

    const next = await getNextDeadlineEvent();
    if (!next) {
      console.log(`${prefix} очередь пуста на сегодня (${getMskTodayDate()} MSK)`);
      return;
    }

    console.log(`${prefix} → отправляем дедлайн ${next.appeal_number}`);
    await sendDeadlineNotification(next, bot);
  } catch (err) {
    console.error(`${prefix} ошибка:`, err.message);
  }
}

function startLoadingDeadlineWorker(bot) {
  schedule.scheduleJob(DEADLINE_CRON_PATTERN, () => {
    runDeadlineCheck(bot);
  });

  const hoursLabel = DEADLINE_24_7 ? "круглосуточно (тест)" : "9–20 MSK";
  console.log(
    `[loading-deadlines] воркер запущен: ${DEADLINE_CRON_PATTERN} (каждые 30 мин, ${hoursLabel})`,
  );

  setTimeout(() => {
    runDeadlineCheck(bot).catch((err) =>
      console.error("[loading-deadlines] стартовая проверка:", err.message),
    );
  }, 7000);
}

module.exports = { startLoadingDeadlineWorker, runDeadlineCheck };
