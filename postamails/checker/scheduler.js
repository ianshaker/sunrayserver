const schedule = require("node-schedule");
const { CRON_PATTERN } = require("../config");
const { initGmailClient } = require("../gmail/client");
const { setTelegramBot } = require("../telegramNotify");
const { checkNewEmails } = require("./runCheck");
const { needsGmailAuthNotification, notifyTokenRefreshNeeded } = require("./tokenAlerts");

async function startEmailChecker(telegramBot) {
  setTelegramBot(telegramBot);
  console.log("[postamails] Инициализация проверки почты...");

  try {
    await initGmailClient();
  } catch (err) {
    console.error("[postamails] Gmail не инициализирован:", err.message);
    console.error(
      "[postamails] После деплоя откройте /gmail/setup для авторизации.",
    );
    if (needsGmailAuthNotification(err.message)) {
      await notifyTokenRefreshNeeded();
    }
  }

  schedule.scheduleJob(CRON_PATTERN, checkNewEmails);

  const now = new Date();
  const hourMsk = (now.getUTCHours() + 3) % 24;
  console.log("[postamails] Cron:", CRON_PATTERN);
  console.log(
    `[postamails] Автопроверка запущена (круглосуточно). Сейчас МСК ${hourMsk}:${now.getMinutes()}`,
  );
}

module.exports = { startEmailChecker };
