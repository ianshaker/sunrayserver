// ============================================================================
// Топливные записи для назначения замера — зеркало CRM fuelService.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { getFuelKey } = require("../lib/mastersDirectory");

/** Общая таблица топлива: у каждой строки колонка master (ключ мастера), первичный ключ — (master, id). */
const FUEL_TABLE = "toplivo_all";

/** Имя мастера (как в eventsnew.master) → ключ мастера в колонке toplivo_all.master; список — таблица masters. */
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
    master: key,
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

  const { data, error } = await supabase.from(FUEL_TABLE).insert(row).select("id").single();

  if (error) {
    console.error(`[loading-deadlines/fuel] insert ${FUEL_TABLE} master=${key}:`, error.message);
    throw error;
  }

  console.log(`[loading-deadlines/fuel] ✅ ${FUEL_TABLE} master=${key} id=${data?.id} ${record.appeal_id}`);
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
    .from(FUEL_TABLE)
    .select("id")
    .eq("master", key)
    .eq("appeal_id", appealId)
    .eq("event_type", "замер")
    .order("id", { ascending: false })
    .limit(1);

  if (findErr) {
    console.error(`[loading-deadlines/fuel] find ${FUEL_TABLE} master=${key}:`, findErr.message);
    return false;
  }

  const row = rows?.[0];
  if (!row) {
    console.log(`[loading-deadlines/fuel] запись не найдена ${FUEL_TABLE} master=${key} ${appealId}`);
    return false;
  }

  // Номера id у разных мастеров повторяются — без фильтра master удалится чужая поездка.
  const { error: delErr } = await supabase.from(FUEL_TABLE).delete().eq("master", key).eq("id", row.id);
  if (delErr) {
    console.error(`[loading-deadlines/fuel] delete ${FUEL_TABLE} master=${key}:`, delErr.message);
    return false;
  }

  console.log(`[loading-deadlines/fuel] 🗑 удалена ${FUEL_TABLE} master=${key} id=${row.id}`);
  return true;
}

module.exports = {
  getFuelTableKey,
  insertFuelRecord,
  deleteFuelRecordByAppeal,
};
