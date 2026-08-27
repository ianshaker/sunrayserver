// ============================================================================
// Признаки рассылки для почтовых заявок.
//
// Ничего не отсеивает: возвращает список причин, из которых собирается пометка
// в сообщении Telegram. Заявка уходит в чат в любом случае.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { APPEAL_SOURCE } = require("../config");

/** Так и только так формы сайта отдают номер (маска «+7 (*99) 999-99-99»). */
const SITE_MASK = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;

/** Окно памяти о том, что уже приходило. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Повтор моложе этого — дубль формы, а не рассылка: письма идут парой через ~44 секунды. */
const FRESH_DUPLICATE_MS = 5 * 60 * 1000;

/**
 * @param {string|null} rawPhone номер так, как он записан в письме
 * @param {string|null} normalizedPhone номер в формате базы
 * @param {string|null} clientName
 * @returns {Promise<string[]>} причины; пустой массив — заявка обычная
 */
async function collectSpamReasons({ rawPhone, normalizedPhone, clientName }) {
  const reasons = [];

  if (!rawPhone || !SITE_MASK.test(rawPhone)) {
    reasons.push("номер записан не как из маски сайта");
  }

  const now = Date.now();
  const { data, error } = await supabase
    .from("appeals")
    .select("client_name, phone")
    .eq("source", APPEAL_SOURCE)
    .gte("created_at", new Date(now - WINDOW_MS).toISOString())
    .lte("created_at", new Date(now - FRESH_DUPLICATE_MS).toISOString());

  if (error) {
    // Не смогли посмотреть сутки — работаем по одной маске, заявку не задерживаем.
    console.error("[postamails/spam] сутки не прочитаны:", error.message);
    return reasons;
  }

  const recent = data || [];
  if (normalizedPhone && recent.some((row) => row.phone === normalizedPhone)) {
    reasons.push("этот номер уже писал за сутки");
  }
  if (clientName && recent.some((row) => row.client_name === clientName)) {
    reasons.push("это имя уже приходило за сутки");
  }

  return reasons;
}

/** Строка пометки для сообщения Telegram. Причин нет — пустая строка. */
function formatSpamNotice(reasons) {
  if (!reasons.length) return "";
  return `\n⚠️ <b>Вероятно спам</b> — ${reasons.join(", ")}`;
}

module.exports = {
  SITE_MASK,
  collectSpamReasons,
  formatSpamNotice,
};
