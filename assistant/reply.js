// ============================================================================
// Ответы ассистента в Telegram.
// ============================================================================

const { getTelegramBot } = require("../tgwebhook/bot");
const { REPLIES, buildPermissionReply, ADMIN_TELEGRAM_USERNAME } = require("./config");

async function sendText(chatId, text, options = {}) {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[assistant/reply] нет telegramBot для ответа");
    return;
  }
  await bot.sendMessage(chatId, text, {
    disable_web_page_preview: true,
    ...options,
  });
}

async function sendUnknown(chatId) {
  await sendText(chatId, REPLIES.UNKNOWN);
}

async function sendError(chatId) {
  await sendText(chatId, REPLIES.ERROR);
}

async function sendAiDisabled(chatId) {
  await sendText(chatId, REPLIES.AI_DISABLED);
}

async function sendPermissionDenied(chatId, kind) {
  const text = buildPermissionReply(kind, ADMIN_TELEGRAM_USERNAME);
  if (!text) {
    await sendUnknown(chatId);
    return;
  }
  await sendText(chatId, text);
}

module.exports = {
  sendText,
  sendUnknown,
  sendError,
  sendAiDisabled,
  sendPermissionDenied,
};
