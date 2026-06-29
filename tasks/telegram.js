const { TELEGRAM_PARSE_MODE } = require("./config");

async function sendTaskTelegramMessage(telegramBot, chatId, text, replyMarkup, extraOptions = {}) {
  const options = { disable_web_page_preview: true, ...extraOptions };
  if (extraOptions.parse_mode) {
    options.parse_mode = extraOptions.parse_mode;
  } else if (TELEGRAM_PARSE_MODE) {
    options.parse_mode = TELEGRAM_PARSE_MODE;
  }
  if (replyMarkup) {
    options.reply_markup = replyMarkup;
  }
  await telegramBot.sendMessage(chatId, text, options);
}

module.exports = { sendTaskTelegramMessage };
