// ============================================================================
// Удаление строк mango_calls без файла записи (storage_path IS NULL).
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { MAX_IDS_PER_REQUEST } = require("./config");

/**
 * @param {string[]} ids
 * @returns {Promise<{ deleted: number, skipped: { id: string, reason: string }[], deleted_ids: string[] }>}
 */
async function deleteRowsByIds(ids) {
  const unique = [...new Set((ids || []).filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) {
    return { deleted: 0, skipped: [], deleted_ids: [] };
  }
  if (unique.length > MAX_IDS_PER_REQUEST) {
    const err = new Error(`Слишком много id (макс. ${MAX_IDS_PER_REQUEST})`);
    err.code = "too_many_ids";
    throw err;
  }

  const { data: rows, error: selectError } = await supabase
    .from("mango_calls")
    .select("id, storage_path")
    .in("id", unique);

  if (selectError) {
    const err = new Error(selectError.message);
    err.code = "select_failed";
    throw err;
  }

  const found = new Map((rows || []).map((r) => [r.id, r]));
  const skipped = [];
  const deletable = [];

  for (const id of unique) {
    const row = found.get(id);
    if (!row) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    if (row.storage_path) {
      skipped.push({ id, reason: "has_storage_path" });
      continue;
    }
    deletable.push(id);
  }

  if (deletable.length === 0) {
    return { deleted: 0, skipped, deleted_ids: [] };
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from("mango_calls")
    .delete()
    .in("id", deletable)
    .select("id");

  if (deleteError) {
    const err = new Error(deleteError.message);
    err.code = "delete_failed";
    throw err;
  }

  const deleted_ids = (deletedRows || []).map((r) => r.id);
  return {
    deleted: deleted_ids.length,
    skipped,
    deleted_ids,
  };
}

module.exports = { deleteRowsByIds };
