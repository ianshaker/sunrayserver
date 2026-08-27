const { GMAIL_LABEL_QUERY, EMAIL_QUIET_LOG_EVERY } = require("../config");
const { ensureGmailClient } = require("../gmail/client");
const {
  filterUnprocessedMessageIds,
  markMessageProcessed,
} = require("../gmail/processedMessages");
const { extractEmailBodyFromPayload } = require("../parsing/emailFields");
const { insertAppealFromEmail } = require("../appeals/insertFromEmail");
const { needsGmailAuthNotification, notifyTokenRefreshNeeded } = require("./tokenAlerts");
const { createQuietDigest } = require("../../lib/quietDigest");

const quietDigest = createQuietDigest("[postamails]", EMAIL_QUIET_LOG_EVERY);

/** Сбой сети или базы не должен закрывать письмо навсегда: даём ему ещё два прохода. */
const MAX_ATTEMPTS = 3;

/** message_id → сколько раз уже падало. Живёт в памяти: после рестарта счёт начинается заново. */
const failedAttempts = new Map();

function logTimePrefix(now = new Date()) {
  const utcHours = now.getUTCHours();
  const hourMsk = (utcHours + 3) % 24;
  return `[${now.toISOString()}] MSK ${hourMsk}:${now.getMinutes()}`;
}

async function checkNewEmails() {
  const now = new Date();
  const prefix = logTimePrefix(now);

  try {
    const gmailClient = await ensureGmailClient();
    const formattedDate = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

    const res = await gmailClient.users.messages.list({
      userId: "me",
      q: `${GMAIL_LABEL_QUERY} after:${formattedDate}`,
      maxResults: 20,
    });

    const ids = (res.data.messages || []).map((m) => m.id);
    const newIds = await filterUnprocessedMessageIds(ids);

    if (!newIds.length) {
      quietDigest.onQuiet();
      return;
    }

    quietDigest.onActivity();
    console.log(`${prefix} новых писем: ${newIds.length}`);

    for (const id of newIds) {
      try {
        const details = await gmailClient.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const body = extractEmailBodyFromPayload(details.data.payload);
        const result = await insertAppealFromEmail(body);
        await markMessageProcessed(id, {
          outcome: result.outcome,
          phone: result.phone,
          appealNumber: result.appealNumber,
          spamReason: result.spamReason,
        });
        failedAttempts.delete(id);
      } catch (err) {
        const attempt = (failedAttempts.get(id) || 0) + 1;
        failedAttempts.set(id, attempt);
        console.error(
          `${prefix} ошибка письма ${id} (попытка ${attempt} из ${MAX_ATTEMPTS}):`,
          err.message,
        );

        // Пока попытки не исчерпаны — письмо не помечаем, и следующая проверка возьмёт его снова.
        if (attempt < MAX_ATTEMPTS) continue;

        try {
          await markMessageProcessed(id, { outcome: "error" });
          failedAttempts.delete(id);
        } catch (markErr) {
          console.error(`${prefix} не удалось записать error для ${id}:`, markErr.message);
        }
      }
    }

    console.log(`${prefix} обработка завершена (${newIds.length} писем)`);
  } catch (err) {
    quietDigest.onActivity();
    console.error(`${prefix} ошибка проверки почты:`, err.message);

    if (needsGmailAuthNotification(err.message)) {
      await notifyTokenRefreshNeeded();
    }
  }
}

module.exports = { checkNewEmails };
