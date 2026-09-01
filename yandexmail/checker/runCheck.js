// ============================================================================
// yandexmail/checker/runCheck — один проход по почте Яндекса.
//
// Порядок намеренно такой: сначала дёшево берём заголовки, отбираем свои
// письма правилом, и только для них скачиваем тело. Чужая переписка при этом
// не вычитывается: у неё смотрится только строка «от кого».
//
// Закладка двигается строго до последнего письма, которое реально разобралось.
// Упало письмо — закладка стоит, и следующий проход возьмёт его снова. Иначе
// одна ошибка базы или Telegram означала бы потерянную заявку, а заявку терять
// нельзя. Чтобы одно битое письмо не заперло очередь навсегда, после трёх
// неудач оно пропускается с отдельной записью в лог.
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
const { processAppealMail, extractText } = require("../pipeline/processMail");
const { isShadowMode } = require("../config");
const { bump, markSuccess, markMailSeen } = require("./counters");
const { insertAppealFromEmail } = require("../../postamails/appeals/insertFromEmail");
const { mskLogPrefix } = require("../../lib/mskTime");

/** Сколько писем разбираем за один проход, чтобы не залипнуть надолго. */
const MAX_PER_RUN = 30;

/** Сколько раз пробуем одно и то же письмо, прежде чем пропустить его. */
const MAX_ATTEMPTS = 3;

/** Номер письма → сколько раз он уже падал. Живёт в памяти процесса. */
const failedAttempts = new Map();

/** Разобрать одно письмо. Бросает наверх, если разбор не удался. */
async function handleOne(client, header, live, prefix) {
  const raw = await fetchRawSource(client, header.uid);
  if (!raw) throw new Error("письмо не отдалось целиком");

  if (!live) {
    const result = await processAppealMail(raw, header);
    if (result.outcome === "would_create") bump("wouldCreate");
    else if (result.outcome === "seen_duplicate") bump("duplicate");
    else if (result.outcome === "blacklisted") bump("blacklisted");
    else if (result.outcome === "no_phone") bump("noPhone");
    return;
  }

  // Боевой режим: та же обработка, что и у Gmail. Карточка, поиск дублей,
  // чёрный список, сообщения в чат — всё общее, ничего своего: два источника
  // обязаны вести себя одинаково.
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
}

async function checkOnce() {
  const prefix = mskLogPrefix("yandexmail");
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
      if (mine.length) {
        console.log(`${prefix} писем ${headers.length}, из них наших ${mine.length} (${plan.reason})`);
      }

      // Идём по письмам подряд и двигаем закладку только за разобранными.
      let confirmedUid = plan.lastUid;

      for (const header of headers) {
        if (!isAppeal(header)) {
          confirmedUid = Math.max(confirmedUid, header.uid);
          continue;
        }

        bump("appeals");
        try {
          await handleOne(client, header, live, prefix);
          failedAttempts.delete(header.uid);
          confirmedUid = Math.max(confirmedUid, header.uid);
        } catch (error) {
          bump("errors");
          const attempt = (failedAttempts.get(header.uid) || 0) + 1;
          failedAttempts.set(header.uid, attempt);
          console.error(
            `${prefix} письмо #${header.uid} не разобрано (попытка ${attempt} из ${MAX_ATTEMPTS}):`,
            error.message,
          );

          if (attempt < MAX_ATTEMPTS) {
            // Закладка остаётся на прошлом письме: это письмо возьмём снова.
            break;
          }

          bump("skipped");
          console.error(
            `${prefix} письмо #${header.uid} пропущено после ${MAX_ATTEMPTS} попыток — разобрать вручную`,
          );
          failedAttempts.delete(header.uid);
          confirmedUid = Math.max(confirmedUid, header.uid);
        }
      }

      if (confirmedUid > plan.lastUid) {
        await writeCursor({ uidValidity: mailbox.uidValidity, lastUid: confirmedUid });
      }
      markSuccess();
    });
  } catch (error) {
    bump("errors");
    // Отказ авторизации отдаём наверх: расписание умеет выждать, пока Яндекс
    // включит новый пароль приложения, вместо попыток каждую минуту.
    if (error?.kind === "auth") throw error;
    console.error(`${prefix} проход не удался (${error.kind || "?"}):`, error.message);
  }
}

module.exports = { MAX_PER_RUN, MAX_ATTEMPTS, checkOnce };
