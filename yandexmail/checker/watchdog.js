// ============================================================================
// yandexmail/checker/watchdog — сторож тишины.
//
// Пока работал Gmail, о поломке почты сообщал разбор текста его ошибки. Когда
// главным источником становится Яндекс, этот сигнал исчезает: чтение может
// встать молча, и узнаем мы об этом только по отсутствию заявок.
//
// Сторож смотрит на две вещи:
//   1) давно ли был успешный проход по почте — это про связь и доступ;
//   2) давно ли вообще приходили письма — это про фильтры, ярлыки и папку.
//
// Обе тревоги повторяются не чаще, чем раз в час: сторож обязан разбудить,
// а не превратиться в фон.
// ============================================================================

const { notifyIncomingChatMarkdown } = require("../../postamails/telegramNotify");
const { getCounters } = require("./counters");
const { isWorkTime } = require("../../lib/mskTime");
const { isEnabled } = require("../config");
const { isGmailCheckerEnabled } = require("../../postamails/checker/scheduler");
const { getCursorHealth } = require("../pipeline/cursor");

/** Нет успешного прохода дольше этого — связь потеряна. */
const NO_SUCCESS_ALERT_MS = 10 * 60 * 1000;

/** Нет ни одного письма дольше этого в рабочие часы — что-то с отбором. */
const NO_MAIL_ALERT_MS = 3 * 60 * 60 * 1000;

/**
 * Закладка не ложится в базу дольше этого — молчаливая беда: пока сервер не
 * перезапускают, всё выглядит исправным, а перезапуск откатывает робота назад
 * и сыплет повторами в чат. Ровно так вышло 22.09.2026.
 */
const CURSOR_STUCK_MS = 10 * 60 * 1000;

/** Чаще этого одну и ту же тревогу не повторяем. */
const REPEAT_ALERT_MS = 60 * 60 * 1000;

const WORK_HOURS_MSK = { from: 9, to: 21 };

/** Как часто сторож осматривает почту. */
const INSPECT_EVERY_MS = 5 * 60 * 1000;

let lastAlertAt = { noSuccess: 0, noMail: 0, noSource: 0, cursorStuck: 0 };
let inspectTimer = null;

function isWorkHours(now = new Date()) {
  return isWorkTime(WORK_HOURS_MSK.from, WORK_HOURS_MSK.to, now);
}

async function alert(kind, text) {
  const now = Date.now();
  if (now - lastAlertAt[kind] < REPEAT_ALERT_MS) return;
  lastAlertAt[kind] = now;

  try {
    await notifyIncomingChatMarkdown(text);
  } catch (error) {
    console.error("[yandexmail/сторож] не удалось отправить тревогу:", error.message);
  }
}

/** Один осмотр. Ничего не чинит — только будит человека. */
async function inspect(now = Date.now()) {
  // Ни одного включённого источника — самое опасное состояние: почту никто
  // не читает, и без этой проверки узнать об этом было бы неоткуда.
  if (!isEnabled() && !isGmailCheckerEnabled()) {
    await alert(
      "noSource",
      "🚨 *Почту не читает никто*\n\n" +
        "Оба источника выключены: и Яндекс, и Gmail. Заявки с сайта сейчас не попадают " +
        "ни в CRM, ни в чат. Письма при этом лежат в ящике и не пропадают.",
    );
    return;
  }

  if (!isEnabled()) return; // Gmail работает и сам сообщает о своих бедах

  const counters = getCounters();
  const lastSuccess = counters.lastSuccessAt ? Date.parse(counters.lastSuccessAt) : 0;

  if (!lastSuccess || now - lastSuccess > NO_SUCCESS_ALERT_MS) {
    const minutes = lastSuccess ? Math.round((now - lastSuccess) / 60000) : null;
    await alert(
      "noSuccess",
      "⚠️ *Почта Яндекса не отвечает*\n\n" +
        (minutes
          ? `Последняя успешная проверка была ${minutes} мин назад.`
          : "Успешных проверок не было ни разу с запуска.") +
        `\nОшибок подряд: ${counters.errorsInRow}.\n\n` +
        "Заявки с почты сейчас могут не доходить. Письма при этом в ящике не пропадают.",
    );
    return;
  }

  // Связь с почтой есть, письма идут — но закладка может не доходить до базы.
  // Снаружи это не видно вовсе, поэтому спрашиваем у неё самой.
  const cursor = getCursorHealth();
  if (!cursor.tableMissing && cursor.failuresInRow > 0) {
    const lastWrite = cursor.lastDbWriteAt ? Date.parse(cursor.lastDbWriteAt) : 0;
    if (!lastWrite || now - lastWrite > CURSOR_STUCK_MS) {
      const minutes = lastWrite ? Math.round((now - lastWrite) / 60000) : null;
      await alert(
        "cursorStuck",
        "⚠️ *Закладка почты не сохраняется*\n\n" +
          (minutes
            ? `Последний раз легла в базу ${minutes} мин назад.`
            : "Ни разу не легла в базу с запуска.") +
          `\nНеудачных попыток подряд: ${cursor.failuresInRow}.` +
          (cursor.lastError ? `\nПричина: ${cursor.lastError}` : "") +
          "\n\nЗаявки сейчас обрабатываются нормально. Но если сервер перезапустить, " +
          "робот вернётся к старому месту и пришлёт сюда пачку повторов.",
      );
    }
  }

  const lastMailSeenAt = counters.lastMailSeenAt || 0;
  if (isWorkHours(new Date(now)) && now - lastMailSeenAt > NO_MAIL_ALERT_MS) {
    const hours = Math.round((now - lastMailSeenAt) / 3600000);
    await alert(
      "noMail",
      "⚠️ *Почта молчит*\n\n" +
        `Связь с ящиком есть, но писем нет уже ${hours} ч подряд в рабочее время.\n` +
        "Стоит проверить, приходят ли заявки в сам ящик и не изменился ли адрес отправителя формы.",
    );
  }
}

/**
 * Сторож поднимается сам по себе и не зависит от того, включён ли источник.
 * В этом весь смысл: выключенный источник — тоже повод разбудить человека.
 */
function startMailWatchdog() {
  if (inspectTimer) return;
  inspectTimer = setInterval(() => {
    inspect().catch((e) => console.error("[yandexmail/сторож]", e.message));
  }, INSPECT_EVERY_MS);
  console.log(
    `[yandexmail/сторож] запущен: осмотр каждые ${Math.round(INSPECT_EVERY_MS / 60000)} мин. ` +
      `Молчание связи дольше ${Math.round(NO_SUCCESS_ALERT_MS / 60000)} мин или тишина в почте ` +
      `дольше ${Math.round(NO_MAIL_ALERT_MS / 3600000)} ч в рабочее время — сообщение в чат.`,
  );
}

function stopMailWatchdog() {
  if (inspectTimer) clearInterval(inspectTimer);
  inspectTimer = null;
}

module.exports = {
  NO_SUCCESS_ALERT_MS,
  NO_MAIL_ALERT_MS,
  REPEAT_ALERT_MS,
  INSPECT_EVERY_MS,
  inspect,
  isWorkHours,
  startMailWatchdog,
  stopMailWatchdog,
};
