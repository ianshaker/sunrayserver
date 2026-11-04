// ============================================================================
// Топливные записи для назначения замера — зеркало CRM fuelService.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { getFuelKey } = require("../lib/mastersDirectory");

/** Имя мастера (как в eventsnew.master) → ключ таблицы toplivo_*; список — таблица masters. */
function getFuelTableKey(masterName) {
  return getFuelKey(masterName);
}

/**
 * @param {string} masterName
 * @param {{
 *   date: string,
 *   time: string,
 *   address: string,
 *   place_id: string|null,
 *   appeal_id: string|null,
 * }} record
 */
async function insertFuelRecord(masterName, record) {
  const key = getFuelTableKey(masterName);
  if (!key) {
    throw new Error(`unknown_fuel_master:${masterName}`);
  }

  const row = {
    date: record.date,
    time: record.time,
    address: record.address,
    place_id: record.place_id || null,
    appeal_id: record.appeal_id || null,
    contract_id: null,
    event_type: "замер",
    status: "не выплачено",
    comment: "",
  };

  const { data, error } = await supabase.from(`toplivo_${key}`).insert(row).select("id").single();

  if (error) {
    console.error(`[loading-deadlines/fuel] insert toplivo_${key}:`, error.message);
    throw error;
  }

  console.log(`[loading-deadlines/fuel] ✅ toplivo_${key} id=${data?.id} ${record.appeal_id}`);
  return data;
}

/**
 * Удаляет топливную запись замера по appeal_id (откат / возврат).
 *
 * @param {string} masterName
 * @param {string} appealId
 */
async function deleteFuelRecordByAppeal(masterName, appealId) {
  const key = getFuelTableKey(masterName);
  if (!key || !appealId) return false;

  const { data: rows, error: findErr } = await supabase
    .from(`toplivo_${key}`)
    .select("id")
    .eq("appeal_id", appealId)
    .eq("event_type", "замер")
    .order("id", { ascending: false })
    .limit(1);

  if (findErr) {
    console.error(`[loading-deadlines/fuel] find toplivo_${key}:`, findErr.message);
    return false;
  }

  const row = rows?.[0];
  if (!row) {
    console.log(`[loading-deadlines/fuel] запись не найдена toplivo_${key} ${appealId}`);
    return false;
  }

  const { error: delErr } = await supabase.from(`toplivo_${key}`).delete().eq("id", row.id);
  if (delErr) {
    console.error(`[loading-deadlines/fuel] delete toplivo_${key}:`, delErr.message);
    return false;
  }

  console.log(`[loading-deadlines/fuel] 🗑 удалена toplivo_${key} id=${row.id}`);
  return true;
}

module.exports = {
  getFuelTableKey,
  insertFuelRecord,
  deleteFuelRecordByAppeal,
};
