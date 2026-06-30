// ============================================================================
// Отправка Telegram-уведомлений о дедлайнах входящих.
// ============================================================================

const { DEADLINE_CHAT_ID, DEADLINE_THREAD_ID } = require("./config");
const { formatDeadlineCard } = require("./messages");
const { markDeadlineNotifSent } = require("./queries");

/**
 * Отправляет полную карточку дедлайна в Telegram-чат и сохраняет message_id в БД.
 *
 * @param {object} appeal    — строка из таблицы appeals
 * @param {object} bot       — экземпляр node-telegram-bot-api
 */
async function sendDeadlineNotification(appeal, bot) {
  const { text, parseMode } = formatDeadlineCard(appeal);

  let sentMsg;
  try {
    sentMsg = await bot.sendMessage(DEADLINE_CHAT_ID, text, {
      parse_mode: parseMode,
      message_thread_id: DEADLINE_THREAD_ID,
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error(
      `[appeals-deadlines/notifier] ошибка отправки TG для заявки ${appeal.appeal_number}:`,
      err.message,
    );
    throw err;
  }

  const tgMsgId = sentMsg?.message_id ?? null;

  await markDeadlineNotifSent(appeal.id, tgMsgId);

  console.log(
    `[appeals-deadlines/notifier] ✅ отправлена карточка ${appeal.appeal_number} → ` +
      `msg_id=${tgMsgId}`,
  );
}

/**
 * Отправляет напоминание-реплай на исходную карточку.
 * Вызывается при каждой плановой проверке, если активная заявка не была закрыта.
 *
 * @param {object} appeal   — строка appeals (нужны appeal_number, deadline_notif_tg_msg_id)
 * @param {object} bot
 */
async function sendDeadlineReminder(appeal, bot) {
  const replyText =
    `⏰ Напоминаю: дедлайн по заявке <b>${appeal.appeal_number}</b> ещё не закрыт.\n` +
    `Отметьте @SUNRAYY_bot с номером заявки и укажите действие.`;

  try {
    await bot.sendMessage(DEADLINE_CHAT_ID, replyText, {
      parse_mode: "HTML",
      message_thread_id: DEADLINE_THREAD_ID,
      reply_to_message_id: appeal.deadline_notif_tg_msg_id ?? undefined,
      disable_web_page_preview: true,
    });
    console.log(
      `[appeals-deadlines/notifier] ⏰ напоминание отправлено для ${appeal.appeal_number}`,
    );
  } catch (err) {
    console.error(
      `[appeals-deadlines/notifier] ошибка напоминания ${appeal.appeal_number}:`,
      err.message,
    );
    // Не бросаем — напоминание некритично
  }
}

module.exports = { sendDeadlineNotification, sendDeadlineReminder };
