// Держатель экземпляра node-telegram-bot-api для отправки ответов из хендлеров.
// server.js создаёт бота один раз и кладёт сюда через setTelegramBot().

let telegramBot = null;

function setTelegramBot(bot) {
  telegramBot = bot;
}

function getTelegramBot() {
  return telegramBot;
}

module.exports = { setTelegramBot, getTelegramBot };
