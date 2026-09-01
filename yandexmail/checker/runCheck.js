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
const { extractText } = require("../pipeline/processMail");
const { insertAppealFromEmail } = require("../../postamails/appeals/insertFromEmail");

/** Сколько писем разбираем за один проход, чтобы не залипнуть надолго. */
const MAX_PER_RUN = 30;

const counters = {
  runs: 0,
  seen: 0,
  appeals: 0,
  created: 0,
  contract: 0,
  wouldCreate: 0,
  duplicate: 0,
  blacklisted: 0,
  noPhone: 0,
  errors: 0,
  lastSuccessAt: null,
};

function logPrefix() {
  const now = new Date();
  const msk = (now.getUTCHours() + 3) % 24;
  return `[yandexmail ${String(msk).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} МСК]`;
}

async function checkOnce() {
  const prefix = logPrefix();
  counters.runs += 1;

  try {
    await withReadOnlyMailbox(async (client) => {
      const mailbox = readMailboxState(client);
      const live = !isShadowMode();
      const plan = await planNextRead(mailbox, { live });

      // Боевой старт без закладки: историю не трогаем, просто отмечаем, где сейчас.
      if (plan.mode === "from_now") {
        await writeCursor({ uidValidity: mailbox.uidValidity, lastUid: plan.lastUid });
        counters.lastSuccessAt = new Date().toISOString();
        console.log(`${prefix} ${plan.reason} (закладка #${plan.lastUid})`);
        return;
      }

      const headers =
        plan.mode === "uid"
          ? await fetchHeadersAfterUid(client, { lastUid: plan.lastUid, limit: MAX_PER_RUN })
          : await fetchRecentHeaders(client, { days: Math.max(1, Math.ceil(plan.hours / 24)), limit: MAX_PER_RUN });

      if (!headers.length) {
        counters.lastSuccessAt = new Date().toISOString();
        return;
      }

      counters.seen += headers.length;
      const mine = headers.filter(isAppeal);
      let maxUid = plan.lastUid;

      for (const header of headers) {
        maxUid = Math.max(maxUid, header.uid);
      }

      if (mine.length) {
        console.log(`${prefix} писем ${headers.length}, из них наших ${mine.length} (${plan.reason})`);
      }

      for (const header of mine) {
        counters.appeals += 1;
        try {
          const raw = await fetchRawSource(client, header.uid);
          if (!raw) {
            counters.errors += 1;
            continue;
          }

          if (live) {
            // Боевой режим: та же обработка, что и у Gmail. Карточка, поиск
            // дублей, чёрный список, сообщения в чат — всё общее, ничего
            // своего: два источника обязаны вести себя одинаково.
            const text = await extractText(raw);
            const result = await insertAppealFromEmail(text);

            if (result.outcome === "created") counters.created += 1;
            else if (result.outcome === "duplicate") counters.duplicate += 1;
            else if (result.outcome === "blacklisted") counters.blacklisted += 1;
            else if (result.outcome === "no_phone") counters.noPhone += 1;
            else if (result.outcome === "contract") counters.contract += 1;

            console.log(
              `${prefix} письмо #${header.uid}: ${result.outcome}` +
                (result.appealNumber ? ` → заявка ${result.appealNumber}` : ""),
            );
          } else {
            const result = await processAppealMail(raw, header);
            if (result.outcome === "would_create") counters.wouldCreate += 1;
            else if (result.outcome === "seen_duplicate") counters.duplicate += 1;
            else if (result.outcome === "blacklisted") counters.blacklisted += 1;
            else if (result.outcome === "no_phone") counters.noPhone += 1;
          }
        } catch (error) {
          counters.errors += 1;
          console.error(`${prefix} письмо #${header.uid}:`, error.message);
        }
      }

      await writeCursor({ uidValidity: mailbox.uidValidity, lastUid: maxUid });
      counters.lastSuccessAt = new Date().toISOString();
    });
  } catch (error) {
    counters.errors += 1;
    console.error(`${prefix} проход не удался (${error.kind || "?"}):`, error.message);
  }
}

function getCounters() {
  return { ...counters };
}

module.exports = { MAX_PER_RUN, checkOnce, getCounters };
