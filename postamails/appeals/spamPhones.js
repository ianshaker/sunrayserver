// ============================================================================
// Чёрный список телефонов.
//
// Список наполняет человек — кнопкой «Спам» в карточке CRM. Сервер только
// исполняет это решение: письмо с таким номером не заводит заявку и не идёт
// в чат, но запись в журнале остаётся — след не теряется никогда.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { normalizePhone } = require("../parsing/phone");

/**
 * Ключ списка — десять цифр без кода страны.
 * «79161192981», «+7 916 119-29-81», «8(916)119-29-81» дают одно и то же.
 * @returns {string|null}
 */
function phoneKey(phone) {
  const digits = String(normalizePhone(phone) || phone || "").replace(/\D/g, "");
  if (digits.length === 11 && /^[78]/.test(digits)) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

/**
 * Номер в списке? Возвращает строку списка или null.
 * База недоступна — считаем, что не в списке: письмо пойдёт обычным путём.
 */
async function findSpamPhone(phone) {
  const key = phoneKey(phone);
  if (!key) return null;

  const { data, error } = await supabase
    .from("spam_phones")
    .select("phone_digits, phone_display, hits")
    .eq("phone_digits", key)
    .maybeSingle();

  if (error) {
    console.error("[postamails/спам-лист] проверка не удалась:", error.message);
    return null;
  }
  return data || null;
}

/** Отбили письмо — растим счётчик и отмечаем, что номер опять приходил. */
async function registerHit(phoneDigits, currentHits = 0) {
  const { error } = await supabase
    .from("spam_phones")
    .update({ hits: currentHits + 1, last_seen: new Date().toISOString() })
    .eq("phone_digits", phoneDigits);

  if (error) {
    console.error("[postamails/спам-лист] счётчик не обновлён:", error.message);
  }
}

/** Добавить номер в список. Повторное добавление того же номера безопасно. */
async function addSpamPhone({ phone, appealNumber = null, addedBy = null }) {
  const key = phoneKey(phone);
  if (!key) throw new Error("Номер не разобран, в список добавить нечего");

  const { error } = await supabase.from("spam_phones").upsert(
    {
      phone_digits: key,
      phone_display: normalizePhone(phone) || phone,
      first_seen: new Date().toISOString(),
      appeal_number: appealNumber,
      added_by: addedBy,
      source: "manager",
    },
    { onConflict: "phone_digits", ignoreDuplicates: true },
  );

  if (error) throw error;
  return key;
}

/** Убрать номер из списка — когда менеджер снял пометку «Спам». */
async function removeSpamPhone(phone) {
  const key = phoneKey(phone);
  if (!key) return false;

  const { error } = await supabase.from("spam_phones").delete().eq("phone_digits", key);
  if (error) throw error;
  return true;
}

module.exports = {
  phoneKey,
  findSpamPhone,
  registerHit,
  addSpamPhone,
  removeSpamPhone,
};
