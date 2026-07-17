// ============================================================================
// Отсчеки после фото графика: reply "1", "2", "3"… на карточки с tg_message_link.
// Порядок массива задаёт CRM (утро → вечер); сервер только нумерует по индексу.
// ============================================================================

const { parseTgMessageLink } = require("../info-na-zamer/tgMessageLink");
const { sendTextMessage } = require("./send");

/** Пауза между отсчеками в одном чате — ~1 с, чтобы не ловить flood/429 от Telegram. */
const DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   chatId: number,
 *   checkmarks: Array<{ tg_message_link?: string }>,
 * }}
 * @returns {Promise<{ sent: number, skipped: number, failed: number }>}
 */
async function sendScheduleCheckmarks({ chatId, checkmarks }) {
  const list = Array.isArray(checkmarks) ? checkmarks : [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    const label = String(i + 1);
    const raw = list[i]?.tg_message_link;
    const parsed = parseTgMessageLink(raw);

    if (!parsed) {
      skipped += 1;
      console.warn(
        `[master-schedule/checkmarks] skip #${label}: bad link=${raw ?? "—"}`,
      );
      continue;
    }

    if (Number(parsed.chatId) !== Number(chatId)) {
      skipped += 1;
      console.warn(
        `[master-schedule/checkmarks] skip #${label}: chat mismatch linkChat=${parsed.chatId} scheduleChat=${chatId}`,
      );
      continue;
    }

    try {
      await sendTextMessage({
        chatId,
        text: label,
        replyToMessageId: parsed.messageId,
      });
      sent += 1;
      console.log(
        `[master-schedule/checkmarks] → #${label} reply_to=${parsed.messageId}`,
      );
    } catch (err) {
      failed += 1;
      console.error(
        `[master-schedule/checkmarks] fail #${label} reply_to=${parsed.messageId}:`,
        err?.message || err,
      );
    }

    if (i < list.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  return { sent, skipped, failed };
}

module.exports = { sendScheduleCheckmarks };
