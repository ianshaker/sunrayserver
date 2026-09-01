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

/** Нет успешного прохода дольше этого — связь потеряна. */
const NO_SUCCESS_ALERT_MS = 10 * 60 * 1000;

/** Нет ни одного письма дольше этого в рабочие часы — что-то с отбором. */
const NO_MAIL_ALERT_MS = 3 * 60 * 60 * 1000;

/** Чаще этого одну и ту же тревогу не повторяем. */
const REPEAT_ALERT_MS = 60 * 60 * 1000;

const WORK_HOURS_MSK = { from: 9, to: 21 };

let lastAlertAt = { noSuccess: 0, noMail: 0 };

function mskHour(now = new Date()) {
  return (now.getUTCHours() + 3) % 24;
}

function isWorkTime(now = new Date()) {
  const hour = mskHour(now);
  return hour >= WORK_HOURS_MSK.from && hour < WORK_HOURS_MSK.to;
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
        `\nОшибок подряд: ${counters.errors}.\n\n` +
        "Заявки с почты сейчас могут не доходить. Письма при этом в ящике не пропадают.",
    );
    return;
  }

  const lastMailSeenAt = counters.lastMailSeenAt || 0;
  if (isWorkTime(new Date(now)) && now - lastMailSeenAt > NO_MAIL_ALERT_MS) {
    const hours = Math.round((now - lastMailSeenAt) / 3600000);
    await alert(
      "noMail",
      "⚠️ *Почта молчит*\n\n" +
        `Связь с ящиком есть, но писем нет уже ${hours} ч подряд в рабочее время.\n` +
        "Стоит проверить, приходят ли заявки в сам ящик и не изменился ли адрес отправителя формы.",
    );
  }
}

module.exports = {
  NO_SUCCESS_ALERT_MS,
  NO_MAIL_ALERT_MS,
  REPEAT_ALERT_MS,
  inspect,
  isWorkTime,
};
