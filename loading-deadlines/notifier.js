// ============================================================================
// Отправка Telegram-уведомлений о дедлайнах погрузки.
// ============================================================================

const { LOADING_DEADLINE_CHAT_ID } = require("./config");
const { formatDeadlineCard, normalizeAppealNumber } = require("./messages");
const { markDeadlineNotifSent, updateDeadlineReminderMsgId } = require("./queries");

/**
 * Удаляет сообщение ⏰-пинга в чате погрузки (ошибку «уже нет» игнорируем).
 *
 * @param {object} bot
 * @param {number|null|undefined} tgMsgId
 */
async function deleteDeadlineReminderMessage(bot, tgMsgId) {
  if (!bot || tgMsgId == null) return;

  try {
    await bot.deleteMessage(LOADING_DEADLINE_CHAT_ID, tgMsgId);
    console.log(`[loading-deadlines/notifier] 🗑 удалён старый пинг msg_id=${tgMsgId}`);
  } catch (err) {
    console.warn(
      `[loading-deadlines/notifier] не удалось удалить пинг msg_id=${tgMsgId}:`,
      err.message,
    );
  }
}

/**
 * Отправляет полную карточку дедлайна в Telegram-чат и сохраняет message_id в БД.
 *
 * @param {object} event — строка из eventsnew
 * @param {object} bot
 */
async function sendDeadlineNotification(event, bot) {
  const { text, parseMode } = formatDeadlineCard(event);

  let sentMsg;
  try {
    sentMsg = await bot.sendMessage(LOADING_DEADLINE_CHAT_ID, text, {
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error(
      `[loading-deadlines/notifier] ошибка отправки TG для ${event.appeal_number}:`,
      err.message,
    );
    throw err;
  }

  const tgMsgId = sentMsg?.message_id ?? null;

  await markDeadlineNotifSent(event.id, tgMsgId);

  console.log(
    `[loading-deadlines/notifier] ✅ отправлена карточка ${event.appeal_number} → ` +
      `msg_id=${tgMsgId}`,
  );
}

/**
 * Отправляет напоминание-реплай на исходную карточку.
 * Перед отправкой удаляет предыдущий ⏰-пинг (если был) и сохраняет новый message_id.
 *
 * @param {object} event
 * @param {object} bot
 */
async function sendDeadlineReminder(event, bot) {
  const replyText = `⏰ Дедлайн погрузки ${normalizeAppealNumber(event.appeal_number)} - не закрыт`;

  await deleteDeadlineReminderMessage(bot, event.deadline_reminder_tg_msg_id);

  try {
    const sentMsg = await bot.sendMessage(LOADING_DEADLINE_CHAT_ID, replyText, {
      parse_mode: "HTML",
      reply_to_message_id: event.deadline_notif_tg_msg_id ?? undefined,
      disable_web_page_preview: true,
    });

    const newMsgId = sentMsg?.message_id ?? null;
    if (newMsgId != null) {
      try {
        await updateDeadlineReminderMsgId(event.id, newMsgId);
      } catch (dbErr) {
        console.error(
          `[loading-deadlines/notifier] пинг ушёл, но id не сохранён ${event.appeal_number}:`,
          dbErr.message,
        );
      }
    }

    console.log(
      `[loading-deadlines/notifier] ⏰ напоминание отправлено для ${event.appeal_number}` +
        ` → msg_id=${newMsgId}`,
    );
  } catch (err) {
    console.error(
      `[loading-deadlines/notifier] ошибка напоминания ${event.appeal_number}:`,
      err.message,
    );
  }
}

module.exports = {
  sendDeadlineNotification,
  sendDeadlineReminder,
  deleteDeadlineReminderMessage,
};
