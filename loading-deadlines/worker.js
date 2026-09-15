// ============================================================================
// Воркер дедлайнов погрузки.
//
// По расписанию DEADLINE_CRON_PATTERN, в часы WORK_HOUR_START–WORK_HOUR_END по Москве
// (или круглосуточно, если DEADLINE_24_7):
//   1. Свежий дедлайн (не старше FRESH_DEADLINE_DAYS), по которому карточки ещё
//      не было, — показываем сразу: новость важнее пинга по висяку. Иначе замер
//      с дедлайном на сегодня встал бы 57-м в очередь и ждал месяц.
//   2. Иначе — ⏰-пинг по активной карточке, которую ещё ни разу не откладывали.
//      После PINGS_BEFORE_SNOOZE доставленных пингов она откладывается до завтра.
//   3. Иначе — карточка следующего висяка (deadline наступил, карточки не было).
//   4. И только когда непоказанных не осталось — пинги по вернувшимся из
//      отложенных, по кругу: кого отложили раньше, тот раньше и вернётся.
// ============================================================================

const schedule = require("node-schedule");
const { mskHour } = require("../lib/mskTime");
const {
  DEADLINE_CRON_PATTERN,
  DEADLINE_24_7,
  WORK_HOUR_START,
  WORK_HOUR_END,
  PINGS_BEFORE_SNOOZE,
  FRESH_DEADLINE_DAYS,
} = require("./config");
const {
  getActiveDeadlineNotif,
  getNextDeadlineEvent,
  getMskTodayDate,
  getMskDateOffset,
  setDeadlineReminderCount,
  snoozeDeadlineEvent,
} = require("./queries");
const {
  sendDeadlineNotification,
  sendDeadlineReminder,
  deleteDeadlineReminderMessage,
} = require("./notifier");

/**
 * Считает доставленные ⏰-пинги по заявке. Набралось PINGS_BEFORE_SNOOZE —
 * откладываем до завтра: пинги прекращаются, очередь берёт следующую заявку,
 * а эта вернётся в круг позади тех, кого ещё не показывали. Карточка в чате
 * остаётся, последний пинг убираем, чтобы не копить хвосты.
 *
 * @param {string} prefix
 * @param {object} event
 * @param {object} bot
 * @param {number|null} pingMessageId — только что отправленный пинг: его и убираем
 */
async function registerReminderAndMaybeSnooze(prefix, event, bot, pingMessageId) {
  const sent = (event.deadline_reminder_count || 0) + 1;

  if (sent < PINGS_BEFORE_SNOOZE) {
    await setDeadlineReminderCount(event.id, sent);
    return;
  }

  const until = getMskDateOffset(1);
  await snoozeDeadlineEvent(event.id, until);
  // В event лежит id прошлого пинга — его уже удалил sendDeadlineReminder.
  await deleteDeadlineReminderMessage(bot, pingMessageId);
  console.log(
    `${prefix} ${event.appeal_number}: ${sent} напоминаний подряд — откладываем до ${until}, ` +
      "очередь берёт следующую",
  );
}

/** ⏰-пинг по заявке и, если он дошёл, счёт с откладыванием на десятом. */
async function pingAndCount(prefix, event, bot) {
  const ping = await sendDeadlineReminder(event, bot);
  if (ping.delivered) {
    await registerReminderAndMaybeSnooze(prefix, event, bot, ping.messageId);
  }
}

async function runDeadlineCheck(bot) {
  const prefix = `[loading-deadlines/worker ${new Date().toISOString()}]`;

  if (!DEADLINE_24_7) {
    const hour = mskHour();
    if (hour < WORK_HOUR_START || hour >= WORK_HOUR_END) {
      return;
    }
  }

  try {
    // 1. Свежая заявка без карточки — показываем сразу.
    const fresh = await getNextDeadlineEvent({
      notEarlierThan: getMskDateOffset(-FRESH_DEADLINE_DAYS),
    });
    if (fresh) {
      console.log(`${prefix} свежий дедлайн ${fresh.appeal_number} — показываем сразу`);
      await sendDeadlineNotification(fresh, bot);
      return;
    }

    // 2. Активная карточка, которую ещё не откладывали.
    const active = await getActiveDeadlineNotif({ neverSnoozedOnly: true });
    if (active) {
      console.log(
        `${prefix} активное уведомление ${active.appeal_number} — отправляем напоминание`,
      );
      await pingAndCount(prefix, active, bot);
      return;
    }

    // 3. Висяк, которого ещё не показывали.
    const next = await getNextDeadlineEvent();
    if (next) {
      console.log(`${prefix} → отправляем дедлайн ${next.appeal_number}`);
      await sendDeadlineNotification(next, bot);
      return;
    }

    // 4. Непоказанных нет — идём по кругу отложенных.
    const returned = await getActiveDeadlineNotif();
    if (!returned) {
      console.log(`${prefix} очередь пуста на сегодня (${getMskTodayDate()} MSK)`);
      return;
    }

    console.log(
      `${prefix} круг отложенных: ${returned.appeal_number} — отправляем напоминание`,
    );
    await pingAndCount(prefix, returned, bot);
  } catch (err) {
    console.error(`${prefix} ошибка:`, err.message);
  }
}

function startLoadingDeadlineWorker(bot) {
  schedule.scheduleJob(DEADLINE_CRON_PATTERN, () => {
    runDeadlineCheck(bot);
  });

  const hoursLabel = DEADLINE_24_7 ? "круглосуточно (тест)" : `${WORK_HOUR_START}–${WORK_HOUR_END} МСК`;
  console.log(
    `[loading-deadlines] воркер запущен: ${DEADLINE_CRON_PATTERN} (${hoursLabel})`,
  );

  setTimeout(() => {
    runDeadlineCheck(bot).catch((err) =>
      console.error("[loading-deadlines] стартовая проверка:", err.message),
    );
  }, 7000);
}

module.exports = { startLoadingDeadlineWorker, runDeadlineCheck };
