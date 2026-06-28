const {
  GMAIL_SETUP_SECRET,
  PUBLIC_BASE_URL,
  SETUP_PATH,
  TOKEN_ERROR_INTERVAL_MS,
} = require("../config");
const { notifyIncomingChatMarkdown } = require("../telegramNotify");

let lastTokenErrorSentAt = 0;

function buildSetupPageUrl() {
  const url = `${PUBLIC_BASE_URL}${SETUP_PATH}`;
  if (!GMAIL_SETUP_SECRET) return url;
  return `${url}?key=${encodeURIComponent(GMAIL_SETUP_SECRET)}`;
}

function isTokenExpiredError(message) {
  if (!message) return false;
  return (
    message.includes("invalid_grant") ||
    message.includes("Token has been expired or revoked")
  );
}

/** Нет файла токена, клиент не поднят после деплоя, или refresh протух. */
function needsGmailAuthNotification(message) {
  if (!message) return false;
  if (isTokenExpiredError(message)) return true;
  return (
    message.includes("No Gmail token found") ||
    message.includes("Gmail client is not initialized")
  );
}

async function notifyTokenRefreshNeeded() {
  if (Date.now() - lastTokenErrorSentAt <= TOKEN_ERROR_INTERVAL_MS) {
    console.log("[postamails] Уведомление о токене уже отправлялось недавно.");
    return;
  }

  lastTokenErrorSentAt = Date.now();

  const setupUrl = buildSetupPageUrl();

  await notifyIncomingChatMarkdown(
    "⚠️ *ВНИМАНИЕ! Токен Gmail API требует обновления!*\n\n" +
      "Для продолжения работы с почтой нужна переавторизация Google.\n\n" +
      `[Открыть страницу активации](${setupUrl})\n\n` +
      "На странице: перейдите в Google, скопируйте код и вставьте в форму.",
  );
}

module.exports = {
  isTokenExpiredError,
  needsGmailAuthNotification,
  notifyTokenRefreshNeeded,
  buildSetupPageUrl,
};
