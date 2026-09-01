// ============================================================================
// postamails/appeals/appealMessage — сообщение о заявке для чата.
//
// Правило одно: показываем то, что есть, и молчим о том, чего нет. Ни одной
// строки-заглушки вроде «Продукт не указан» — если продукта в письме не было,
// строки просто не будет.
//
// Сырой текст письма сюда не попадает: он целиком сохраняется в карточке, и
// менеджер при необходимости смотрит его там.
// ============================================================================

const { escapeHtml } = require("../parsing/emailBodyForTelegram");
const { formatClientMessageBlock } = require("../parsing/clientMessage");

const esc = (value) => escapeHtml(value || "");

/** Пометка о рассылке отделяется пустой строкой: иначе липнет к тексту клиента. */
function withNotice(body, spamNotice) {
  if (!spamNotice) return body.trimEnd();
  return `${body.trimEnd()}\n${spamNotice.trimStart()}`;
}

/** Одна строка «Подпись: значение», либо ничего, если значения нет. */
function line(label, value) {
  const text = String(value || "").trim();
  return text ? `${label}: <b>${esc(text)}</b>\n` : "";
}

/**
 * Сообщение о новой заявке.
 *
 * @param {object} params
 * @param {string} params.appealNumber номер заявки
 * @param {object} params.fields результат parseAppealFields
 * @param {string} params.phone телефон в виде базы
 * @param {string} [params.spamNotice] готовая строка про признаки рассылки
 * @returns {string} HTML для Telegram
 */
/** Заголовок: раздел приписывается, только если он что-то добавляет. */
function title(icon, base, formLabel) {
  const label = String(formLabel || "").trim();
  const same = label.toLowerCase() === base.toLowerCase();
  return `${icon} <b>${base}${same || !label ? "" : ` · ${esc(label)}`}</b>\n`;
}

function buildNewAppealMessage({ appealNumber, fields, phone, spamNotice = "" }) {
  const head = title("📨", "ЗАЯВКА С САЙТА", fields.form.label);

  const body =
    line("Номер", appealNumber) +
    "\n" +
    line("Клиент", fields.name) +
    line("Телефон", phone || fields.phone) +
    line("Город", fields.city) +
    line("Продукт", fields.product) +
    line("Промокод", fields.promo) +
    line("Почта", fields.email);

  return withNotice(head + body + formatClientMessageBlock(fields.message), spamNotice);
}

/**
 * Сообщение о повторе: заявка с этим номером телефона уже заведена.
 * Показывает то же, что и новая, плюс где искать прежнюю карточку.
 */
function buildDuplicateMessage({ existing, fields, phone, spamNotice = "" }) {
  const head = title("📨", "ПОВТОР", fields.form.label) +
    "Заявка с этим номером уже есть в базе.\n";

  const info = existing?.info || {};
  const body =
    line("Прежний номер", info.appeal_id || info.appeal_number) +
    line("Где лежит", existing?.table) +
    "\n" +
    line("Клиент", fields.name || info.client_name) +
    line("Телефон", phone || fields.phone) +
    line("Город", fields.city || info.city) +
    line("Продукт", fields.product) +
    line("Промокод", fields.promo);

  return withNotice(head + body + formatClientMessageBlock(fields.message), spamNotice);
}

/**
 * Сообщение о клиенте из завершённых договоров.
 */
function buildContractMessage({ contract, fields, spamNotice = "" }) {
  const head = title("⛔️", "КЛИЕНТ ИЗ ЗАВЕРШЁННЫХ ДОГОВОРОВ", fields.form.label);

  const body =
    line("Номер", contract.appeal_id) +
    line("Договор", contract.dogovor_number) +
    "\n" +
    line("Клиент", contract.client_name || fields.name) +
    line("Телефон", contract.phone) +
    line("Город", contract.city || fields.city) +
    line("Продукт", fields.product) +
    line("Промокод", fields.promo);

  return withNotice(head + body + formatClientMessageBlock(fields.message), spamNotice);
}

module.exports = {
  line,
  title,
  buildNewAppealMessage,
  buildDuplicateMessage,
  buildContractMessage,
};
