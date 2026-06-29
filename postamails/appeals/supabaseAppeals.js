const { supabase } = require("../supabaseClient");
const { TABLES_TO_CHECK } = require("../config");

async function findExistingAppealByPhone(normalizedPhone) {
  for (const table of TABLES_TO_CHECK) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("phone", normalizedPhone)
      .limit(1);

    if (error) continue;
    if (data?.length) return { table, info: data[0] };
  }
  return null;
}

async function getFreeAppealId() {
  const { data, error } = await supabase
    .from("ids")
    .select("id, appeal_id, is_used, used_at")
    .eq("is_used", false)
    .is("used_at", null)
    .order("id", { ascending: true })
    .limit(10);

  if (error) console.error("[postamails] getFreeAppealId error:", error);
  if (!data?.length) throw new Error("Нет свободных ID");

  return data[0].appeal_id;
}

async function markAppealIdUsed(appeal_id) {
  const used_at = new Date().toISOString();
  const { error } = await supabase
    .from("ids")
    .update({ is_used: true, used_at })
    .eq("appeal_id", appeal_id);

  if (error) {
    console.error(`[postamails] markAppealIdUsed ${appeal_id}:`, error);
  }
}

async function insertAppealRecord(appeal) {
  const { error } = await supabase.from("appeals").insert([appeal]);
  if (error) throw error;
}

module.exports = {
  findExistingAppealByPhone,
  getFreeAppealId,
  markAppealIdUsed,
  insertAppealRecord,
};
