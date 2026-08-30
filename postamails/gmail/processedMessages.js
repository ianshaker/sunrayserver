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
 *   outcome: 'created'|'duplicate'|'contract'|'no_phone'|'blacklisted'|'error',
 *   phone?: string|null,
 *   appealNumber?: string|null,
 *   spamReason?: string|null,
 * }} meta
 */
async function markMessageProcessed(
  messageId,
  { outcome, phone = null, appealNumber = null, spamReason = null },
) {
  const base = {
    message_id: messageId,
    processed_at: new Date().toISOString(),
    phone: phone || null,
    appeal_number: appealNumber || null,
  };

  const { error } = await supabase
    .from("gmail_processed_messages")
    .upsert({ ...base, outcome, spam_reason: spamReason || null }, { onConflict: "message_id" });

  if (!error) return;

  // База ещё без свежей миграции: не знает новых исходов или колонки spam_reason.
  // Пишем по-старому, чтобы письмо не осталось непомеченным и не пошло по кругу.
  console.error(`[postamails/processed] mark ${messageId}:`, error.message);

  const KNOWN_BEFORE = ["created", "duplicate", "contract", "error"];
  const { error: fallbackError } = await supabase
    .from("gmail_processed_messages")
    .upsert(
      { ...base, outcome: KNOWN_BEFORE.includes(outcome) ? outcome : "error" },
      { onConflict: "message_id" },
    );

  if (fallbackError) {
    console.error(`[postamails/processed] mark ${messageId} (запасной путь):`, fallbackError.message);
    throw fallbackError;
  }

  console.log(`[postamails/processed] ${messageId}: записан по-старому, миграция не применена`);
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
