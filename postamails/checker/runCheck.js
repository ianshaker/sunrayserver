const { GMAIL_LABEL_QUERY } = require("../config");
const { ensureGmailClient } = require("../gmail/client");
const { readCache, writeCache } = require("../gmail/tokenStore");
const { extractEmailBodyFromPayload } = require("../parsing/emailFields");
const { insertAppealFromEmail } = require("../appeals/insertFromEmail");
const { needsGmailAuthNotification, notifyTokenRefreshNeeded } = require("./tokenAlerts");

function logTimePrefix(now = new Date()) {
  const utcHours = now.getUTCHours();
  const hourMsk = (utcHours + 3) % 24;
  return `[${now.toISOString()}] MSK ${hourMsk}:${now.getMinutes()}`;
}

async function checkNewEmails() {
  const now = new Date();
  const prefix = logTimePrefix(now);

  console.log(`${prefix} checkNewEmails start`);

  try {
    const gmailClient = await ensureGmailClient();
    const formattedDate = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

    let cache = readCache();
    if (cache.date !== formattedDate) {
      cache = { date: formattedDate, emailIds: [] };
    }

    const res = await gmailClient.users.messages.list({
      userId: "me",
      q: `${GMAIL_LABEL_QUERY} after:${formattedDate}`,
      maxResults: 20,
    });

    const ids = (res.data.messages || []).map((m) => m.id);
    const newIds = ids.filter((id) => !cache.emailIds.includes(id));

    if (!newIds.length) {
      console.log(`${prefix} новых писем нет`);
      return;
    }

    console.log(`${prefix} обрабатываем ${newIds.length} писем`);

    for (const id of newIds) {
      try {
        const details = await gmailClient.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const body = extractEmailBodyFromPayload(details.data.payload);
        await insertAppealFromEmail(body);
      } catch (err) {
        console.error(`${prefix} ошибка письма ${id}:`, err.message);
      }
    }

    cache.emailIds = [...cache.emailIds, ...newIds];
    cache.date = formattedDate;
    writeCache(cache);
    console.log(`${prefix} checkNewEmails done`);
  } catch (err) {
    console.error(`${prefix} ошибка проверки почты:`, err.message);

    if (needsGmailAuthNotification(err.message)) {
      await notifyTokenRefreshNeeded();
    }
  }
}

module.exports = { checkNewEmails };
