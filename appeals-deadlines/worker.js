// ============================================================================
// Воркер дедлайнов входящих.
//
// Каждые 30 мин (9:00–20:00 MSK, или круглосуточно если DEADLINE_24_7):
//   1. Если есть активное неотвеченное уведомление — ждём.
//   2. Иначе — берём следующую заявку с сегодняшним дедлайном и кидаем карточку.
// ============================================================================

const schedule = require("node-schedule");
const {
  DEADLINE_CRON_PATTERN,
  DEADLINE_24_7,
  MSK_OFFSET_HOURS,
  WORK_HOUR_START,
  WORK_HOUR_END,
} = require("./config");
const { getActiveDeadlineNotif, getNextDeadlineAppeal } = require("./queries");
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
  const prefix = `[appeals-deadlines/worker ${new Date().toISOString()}]`;

  // Рабочие часы MSK (пропускаем при DEADLINE_24_7 — режим теста)
  if (!DEADLINE_24_7) {
    const hour = getMskHour();
    if (hour < WORK_HOUR_START || hour >= WORK_HOUR_END) {
      return;
    }
  }

  try {
    // Есть ли активное (неотвеченное) уведомление?
    const active = await getActiveDeadlineNotif();
    if (active) {
      console.log(
        `${prefix} активное уведомление ${active.appeal_number} — отправляем напоминание`,
      );
      await sendDeadlineReminder(active, bot);
      return;
    }

    // Берём следующую заявку в очереди
    const next = await getNextDeadlineAppeal();
    if (!next) {
      return; // Все дедлайны на сегодня обработаны или очередь пуста
    }

    console.log(`${prefix} → отправляем дедлайн ${next.appeal_number}`);
    await sendDeadlineNotification(next, bot);
  } catch (err) {
    console.error(`${prefix} ошибка:`, err.message);
  }
}

function startAppealDeadlineWorker(bot) {
  schedule.scheduleJob(DEADLINE_CRON_PATTERN, () => {
    runDeadlineCheck(bot);
  });

  const hoursLabel = DEADLINE_24_7 ? "круглосуточно (тест)" : "9–20 MSK";
  console.log(
    `[appeals-deadlines] воркер запущен: ${DEADLINE_CRON_PATTERN} (каждые 30 мин, ${hoursLabel})`,
  );
}

module.exports = { startAppealDeadlineWorker, runDeadlineCheck };
