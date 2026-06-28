const {
  GMAIL_SETUP_SECRET,
  PUBLIC_BASE_URL,
  SETUP_PATH,
  TOKEN_ERROR_INTERVAL_MS,
} = require("../config");
const { generateAuthUrl } = require("../gmail/oauth");
const { notifyIncomingChatMarkdown } = require("../telegramNotify");

let lastTokenErrorSentAt = 0;

function buildSetupPageUrl(secretKey) {
  return `${PUBLIC_BASE_URL}${SETUP_PATH}?key=${encodeURIComponent(secretKey)}`;
}

function isTokenExpiredError(message) {
  if (!message) return false;
  return (
    message.includes("invalid_grant") ||
    message.includes("Token has been expired or revoked")
  );
}

async function notifyTokenRefreshNeeded() {
  if (Date.now() - lastTokenErrorSentAt <= TOKEN_ERROR_INTERVAL_MS) {
    console.log("[postamails] Уведомление о токене уже отправлялось недавно.");
    return;
  }

  lastTokenErrorSentAt = Date.now();

  if (!GMAIL_SETUP_SECRET) {
    console.warn(
      "[postamails] GMAIL_SETUP_SECRET не задан — ссылка на страницу активации недоступна.",
    );
    await notifyIncomingChatMarkdown(
      "⚠️ *Токен Gmail API требует обновления!*\n\n" +
        "Задайте `GMAIL_SETUP_SECRET` на Render и откройте `/gmail/setup`.",
    );
    return;
  }

  const setupUrl = buildSetupPageUrl(GMAIL_SETUP_SECRET);

  await notifyIncomingChatMarkdown(
    "⚠️ *ВНИМАНИЕ! Токен Gmail API требует обновления!*\n\n" +
      "Для продолжения работы с почтой нужна переавторизация Google.\n\n" +
      `[Открыть страницу активации на сервере](${setupUrl})\n\n` +
      "На странице: перейдите в Google, скопируйте код и вставьте в форму.",
  );
}

module.exports = {
  isTokenExpiredError,
  notifyTokenRefreshNeeded,
  buildSetupPageUrl,
};
