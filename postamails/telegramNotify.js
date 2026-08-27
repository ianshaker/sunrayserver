const { TELEGRAM_CHAT_ID } = require("./config");

let telegramBot = null;

/** Сетевое моргание не должно стоить заявки: пауза между попытками растёт. */
const SEND_RETRY_MS = [1000, 3000];
const SEND_ATTEMPTS = SEND_RETRY_MS.length + 1;

function setTelegramBot(bot) {
  telegramBot = bot;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWithRetry(chatId, text, parseMode) {
  if (!telegramBot) return;

  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    try {
      await telegramBot.sendMessage(chatId, text, {
        parse_mode: parseMode,
        disable_web_page_preview: false,
      });
      return;
    } catch (err) {
      if (attempt === SEND_ATTEMPTS) throw err;
      console.error(
        `[postamails] отправка в чат не удалась (попытка ${attempt} из ${SEND_ATTEMPTS}): ${err.message}`,
      );
      await wait(SEND_RETRY_MS[attempt - 1]);
    }
  }
}

async function sendHtml(chatId, html) {
  await sendWithRetry(chatId, html, "HTML");
}

async function sendMarkdown(chatId, text) {
  await sendWithRetry(chatId, text, "Markdown");
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
