const schedule = require("node-schedule");
const { CRON_PATTERN, DIGEST_CRON_PATTERN, TOKEN_ALERT_DELAY_MS } = require("../config");
const { initGmailClient } = require("../gmail/client");
const { purgeOldProcessedMessages } = require("../gmail/processedMessages");
const { setTelegramBot } = require("../telegramNotify");
const { checkNewEmails } = require("./runCheck");
const { sendDailyDigest } = require("./dailyDigest");
const { needsGmailAuthNotification, notifyTokenRefreshNeeded } = require("./tokenAlerts");

/** Раз в сутки в 04:00 UTC (07:00 MSK) — чистка журнала старше 30 дней. */
const PURGE_CRON_PATTERN = "0 0 4 * * *";

/**
 * Ветку Gmail можно остановить, не трогая её код: GMAIL_ENABLED=false.
 * Маршруты активации при этом остаются рабочими, чтобы вернуть источник
 * можно было одной переменной, а не выкладкой.
 */
function isGmailCheckerEnabled() {
  return String(process.env.GMAIL_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

async function startEmailChecker(telegramBot) {
  setTelegramBot(telegramBot);

  if (!isGmailCheckerEnabled()) {
    console.log(
      "[postamails] остановлен рубильником GMAIL_ENABLED=false: запросы к Gmail API не выполняются. " +
        "Код и страница активации на месте, возврат — той же переменной.",
    );
    return;
  }

  console.log("[postamails] Инициализация проверки почты...");

  try {
    await initGmailClient();
  } catch (err) {
    console.error("[postamails] Gmail не инициализирован:", err.message);
    console.error(
      "[postamails] После деплоя откройте /gmail/setup для авторизации.",
    );
    if (needsGmailAuthNotification(err.message)) {
      // TG только после полного старта сервера (listen), не во время boot Render.
      setTimeout(() => {
        notifyTokenRefreshNeeded().catch((e) => {
          console.error("[postamails] Ошибка TG-уведомления:", e.message);
        });
      }, TOKEN_ALERT_DELAY_MS);
    }
  }

  schedule.scheduleJob(CRON_PATTERN, checkNewEmails);

  schedule.scheduleJob(PURGE_CRON_PATTERN, () => {
    purgeOldProcessedMessages().catch((err) => {
      console.error("[postamails] ошибка purge processed messages:", err.message);
    });
  });

  schedule.scheduleJob(DIGEST_CRON_PATTERN, () => {
    sendDailyDigest().catch((err) => {
      console.error("[postamails] ошибка суточной сводки:", err.message);
    });
  });

  const now = new Date();
  const hourMsk = (now.getUTCHours() + 3) % 24;
  console.log("[postamails] Cron:", CRON_PATTERN);
  console.log(`[postamails] Purge processed messages: ${PURGE_CRON_PATTERN} (старше 30 дн.)`);
  console.log(`[postamails] Суточная сводка: ${DIGEST_CRON_PATTERN} (06:00 МСК)`);
  console.log(
    `[postamails] Автопроверка запущена (круглосуточно). Сейчас МСК ${hourMsk}:${now.getMinutes()}`,
  );
}

module.exports = { startEmailChecker, isGmailCheckerEnabled };
