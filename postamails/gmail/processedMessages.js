// ============================================================================
// Журнал обработанных Gmail message_id в Supabase (переживает redeploy Render).
// ============================================================================

const { supabase } = require("../supabaseClient");

const RETENTION_DAYS = 30;

/**
 * @param {string[]} messageIds
 * @returns {Promise<string[]>} id, которых ещё нет в журнале
 */
async function filterUnprocessedMessageIds(messageIds) {
  if (!messageIds.length) return [];

  const { data, error } = await supabase
    .from("gmail_processed_messages")
    .select("message_id")
    .in("message_id", messageIds);

  if (error) {
    console.error("[postamails/processed] filterUnprocessed:", error.message);
    throw error;
  }

  const processed = new Set((data || []).map((row) => row.message_id));
  return messageIds.filter((id) => !processed.has(id));
}

/**
 * @param {string} messageId
 * @param {{
 *   outcome: 'created'|'duplicate'|'contract'|'error',
 *   phone?: string|null,
 *   appealNumber?: string|null,
 * }} meta
 */
async function markMessageProcessed(messageId, { outcome, phone = null, appealNumber = null }) {
  const { error } = await supabase.from("gmail_processed_messages").upsert(
    {
      message_id: messageId,
      processed_at: new Date().toISOString(),
      outcome,
      phone: phone || null,
      appeal_number: appealNumber || null,
    },
    { onConflict: "message_id" },
  );

  if (error) {
    console.error(`[postamails/processed] mark ${messageId}:`, error.message);
    throw error;
  }
}

/** Удаляет записи старше RETENTION_DAYS. Безопасно вызывать повторно. */
async function purgeOldProcessedMessages() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);

  const { error, count } = await supabase
    .from("gmail_processed_messages")
    .delete({ count: "exact" })
    .lt("processed_at", cutoff.toISOString());

  if (error) {
    console.error("[postamails/processed] purge:", error.message);
    throw error;
  }

  if (count > 0) {
    console.log(`[postamails/processed] purge: удалено ${count} записей старше ${RETENTION_DAYS} дн.`);
  }

  return count || 0;
}

module.exports = {
  RETENTION_DAYS,
  filterUnprocessedMessageIds,
  markMessageProcessed,
  purgeOldProcessedMessages,
};
