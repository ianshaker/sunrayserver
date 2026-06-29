// Reply на исходную отбивку «✅ Создал задачу #N» (tg_chat_id + tg_message_id в manager_tasks).

const { sendTaskTelegramMessage } = require("./telegram");

function getTaskOrigin(task) {
  const chatId = task?.tg_chat_id != null ? Number(task.tg_chat_id) : null;
  const messageId = task?.tg_message_id != null ? Number(task.tg_message_id) : null;
  if (!chatId || !messageId) return null;
  return { chatId, messageId };
}

async function sendTaskOriginReply(telegramBot, task, text, replyMarkup) {
  const origin = getTaskOrigin(task);
  if (!origin || !telegramBot) return false;

  await sendTaskTelegramMessage(telegramBot, origin.chatId, text, replyMarkup, {
    reply_to_message_id: origin.messageId,
    allow_sending_without_reply: true,
  });
  return true;
}

module.exports = { getTaskOrigin, sendTaskOriginReply };
