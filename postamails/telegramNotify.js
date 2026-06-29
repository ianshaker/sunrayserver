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

async function notifyGmailActivated() {
  await notifyIncomingChat(
    "✅ <b>Gmail API активирован</b>\n\n" +
      "Токен сохранён в базу, проверка почты «Заявки Sunray» возобновлена.",
  );
}

async function notifyGmailTokenNotPersisted() {
  await notifyIncomingChat(
    "❌ <b>Gmail НЕ активирован</b>\n\n" +
      "Код принят, но токен не сохранился в базу. Нужно проверить миграции и активировать заново.",
  );
}

module.exports = {
  setTelegramBot,
  notifyIncomingChat,
  notifyIncomingChatMarkdown,
  notifyGmailActivated,
  notifyGmailTokenNotPersisted,
};
