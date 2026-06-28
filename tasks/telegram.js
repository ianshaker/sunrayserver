const { TELEGRAM_PARSE_MODE } = require("./config");

async function sendTaskTelegramMessage(telegramBot, chatId, text) {
  const options = { disable_web_page_preview: true };
  if (TELEGRAM_PARSE_MODE) {
    options.parse_mode = TELEGRAM_PARSE_MODE;
  }
  await telegramBot.sendMessage(chatId, text, options);
}

module.exports = { sendTaskTelegramMessage };
