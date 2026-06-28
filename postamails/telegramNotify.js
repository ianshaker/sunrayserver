const { TELEGRAM_CHAT_ID } = require("./config");

let telegramBot = null;

function setTelegramBot(bot) {
  telegramBot = bot;
}

async function sendHtml(chatId, html) {
  if (!telegramBot) return;
  await telegramBot.sendMessage(chatId, html, {
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

async function sendMarkdown(chatId, text) {
  if (!telegramBot) return;
  await telegramBot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    disable_web_page_preview: false,
  });
}

async function notifyIncomingChat(html) {
  await sendHtml(TELEGRAM_CHAT_ID, html);
}

async function notifyIncomingChatMarkdown(text) {
  await sendMarkdown(TELEGRAM_CHAT_ID, text);
}

module.exports = {
  setTelegramBot,
  notifyIncomingChat,
  notifyIncomingChatMarkdown,
};
