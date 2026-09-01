// ============================================================================
// yandexmail/checker/runCheck — один проход по почте Яндекса.
//
// Порядок намеренно такой: сначала дёшево берём заголовки, отбираем свои
// письма правилом, и только для них скачиваем тело. Чужая переписка при этом
// не вычитывается: у неё смотрится только строка «от кого».
// ============================================================================

const { withReadOnlyMailbox } = require("../imap/client");
const {
  readMailboxState,
  fetchHeadersAfterUid,
  fetchRecentHeaders,
  fetchRawSource,
} = require("../imap/fetch");
const { planNextRead, writeCursor } = require("../pipeline/cursor");
const { isAppeal } = require("../pipeline/rules");
const { processAppealMail } = require("../pipeline/processMail");
const { isShadowMode } = require("../config");
const { bump, markSuccess, markMailSeen, getCounters } = require("./counters");
const { extractText } = require("../pipeline/processMail");
const { insertAppealFromEmail } = require("../../postamails/appeals/insertFromEmail");

/** Сколько писем разбираем за один проход, чтобы не залипнуть надолго. */
const MAX_PER_RUN = 30;

function logPrefix() {
  const now = new Date();
  const msk = (now.getUTCHours() + 3) % 24;
  return `[yandexmail ${String(msk).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} МСК]`;
}

async function checkOnce() {
  const prefix = logPrefix();
  bump("runs");

  try {
    await withReadOnlyMailbox(async (client) => {
      const mailbox = readMailboxState(client);
      const live = !isShadowMode();
      const plan = await planNextRead(mailbox, { live });

      // Боевой старт без закладки: историю не трогаем, просто отмечаем, где сейчас.
      if (plan.mode === "from_now") {
        await writeCursor({ uidValidity: mailbox.uidValidity, lastUid: plan.lastUid });
        markSuccess();
        console.log(`${prefix} ${plan.reason} (закладка #${plan.lastUid})`);
        return;
      }

      const headers =
        plan.mode === "uid"
          ? await fetchHeadersAfterUid(client, { lastUid: plan.lastUid, limit: MAX_PER_RUN })
          : await fetchRecentHeaders(client, { days: Math.max(1, Math.ceil(plan.hours / 24)), limit: MAX_PER_RUN });

      if (!headers.length) {
        markSuccess();
        return;
      }

      bump("seen", headers.length);
      markMailSeen();
      const mine = headers.filter(isAppeal);
      let maxUid = plan.lastUid;

      for (const header of headers) {
        maxUid = Math.max(maxUid, header.uid);
      }

      if (mine.length) {
        console.log(`${prefix} писем ${headers.length}, из них наших ${mine.length} (${plan.reason})`);
      }

      for (const header of mine) {
        bump("appeals");
        try {
          const raw = await fetchRawSource(client, header.uid);
          if (!raw) {
            bump("errors");
            continue;
          }

          if (live) {
            // Боевой режим: та же обработка, что и у Gmail. Карточка, поиск
            // дублей, чёрный список, сообщения в чат — всё общее, ничего
            // своего: два источника обязаны вести себя одинаково.
            const text = await extractText(raw);
            const result = await insertAppealFromEmail(text);

            if (result.outcome === "created") bump("created");
            else if (result.outcome === "duplicate") bump("duplicate");
            else if (result.outcome === "blacklisted") bump("blacklisted");
            else if (result.outcome === "no_phone") bump("noPhone");
            else if (result.outcome === "contract") bump("contract");

            console.log(
              `${prefix} письмо #${header.uid}: ${result.outcome}` +
                (result.appealNumber ? ` → заявка ${result.appealNumber}` : ""),
            );
          } else {
            const result = await processAppealMail(raw, header);
            if (result.outcome === "would_create") bump("wouldCreate");
            else if (result.outcome === "seen_duplicate") bump("duplicate");
            else if (result.outcome === "blacklisted") bump("blacklisted");
            else if (result.outcome === "no_phone") bump("noPhone");
          }
        } catch (error) {
          bump("errors");
          console.error(`${prefix} письмо #${header.uid}:`, error.message);
        }
      }

      await writeCursor({ uidValidity: mailbox.uidValidity, lastUid: maxUid });
      markSuccess();
    });
  } catch (error) {
    bump("errors");
    console.error(`${prefix} проход не удался (${error.kind || "?"}):`, error.message);
  }
}

module.exports = { MAX_PER_RUN, checkOnce, getCounters };
