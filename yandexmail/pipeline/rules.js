// ============================================================================
// yandexmail/pipeline/rules — какое письмо считать заявкой.
//
// Правило вынесено из кода в настройку: список адресов задаётся переменной
// окружения, по умолчанию — адрес формы сайта. Проверено на живом ящике
// 01.09.2026: из 1278 писем за неделю 1118 пришли именно с него.
//
// Категории заведены заранее (заявка, счёт, срочное), но сегодня работает
// только «заявка»: чтобы завтра добавить новый вид письма, схему менять
// не придётся.
// ============================================================================

const DEFAULT_SENDERS = ["info@zhalyuzi-sunray.ru"];

const CATEGORY_APPEAL = "appeal";

/** Список отправителей заявок. Через запятую в YANDEX_MAIL_APPEAL_SENDERS. */
function appealSenders() {
  const raw = String(process.env.YANDEX_MAIL_APPEAL_SENDERS || "").trim();
  if (!raw) return DEFAULT_SENDERS;
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * К какой категории относится письмо. null — письмо нас не касается,
 * и тело его не скачивается вовсе.
 * @param {{from?: string}} header заголовки из imap/fetch
 * @returns {string|null}
 */
function classify(header) {
  const from = String(header?.from || "").toLowerCase();
  if (!from) return null;
  return appealSenders().includes(from) ? CATEGORY_APPEAL : null;
}

function isAppeal(header) {
  return classify(header) === CATEGORY_APPEAL;
}

module.exports = {
  CATEGORY_APPEAL,
  DEFAULT_SENDERS,
  appealSenders,
  classify,
  isAppeal,
};
