// ============================================================================
// Запись tg_message_link в eventsnew после успешной отправки карточки.
// Ошибки БД только логируем — CRM не должна откатывать событие.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { buildTgMessageLink } = require("./tgMessageLink");

/**
 * @param {number|string|null|undefined} eventId
 * @param {number|string|null|undefined} chatId
 * @param {number|string|null|undefined} messageId
 * @returns {Promise<string|null>} сохранённая ссылка или null
 */
async function persistEventTgMessageLink(eventId, chatId, messageId) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const link = buildTgMessageLink(chatId, messageId);
  if (!link) {
    console.warn(
      `[info-na-zamer] skip tg_message_link: bad chat/msg eventId=${eventId} chat=${chatId} msg=${messageId}`,
    );
    return null;
  }

  try {
    const { error } = await supabase
      .from("eventsnew")
      .update({ tg_message_link: link })
      .eq("id", id);

    if (error) {
      console.error(
        `[info-na-zamer] tg_message_link UPDATE failed eventId=${id}:`,
        error.message,
      );
      return null;
    }

    console.log(`[info-na-zamer] tg_message_link eventId=${id} → ${link}`);
    return link;
  } catch (err) {
    console.error(
      `[info-na-zamer] tg_message_link UPDATE exception eventId=${id}:`,
      err?.message || err,
    );
    return null;
  }
}

module.exports = { persistEventTgMessageLink };
