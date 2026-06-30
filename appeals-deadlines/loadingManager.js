// ============================================================================
// updateManagerRecords — порт логики CRM (ids + salary_*).
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { getMskTodayDate } = require("./queries");
const { SALARY_SALES_MANAGERS } = require("./salesManager");

const SALARY_TABLE = {
  Настя: "salary_nastya",
  Таня: "salary_tanya",
  Света: "salary_sveta",
  Гена: "salary_gena",
};

/**
 * @param {string} salemanager
 * @param {string} appealNumber — #NNNNN
 * @param {{ product_type?: string|null }} appeal
 */
async function updateManagerRecords(salemanager, appealNumber, appeal) {
  if (!salemanager) {
    console.log("[appeals-deadlines/loadingManager] salemanager пуст — пропуск ids/salary");
    return;
  }

  try {
    const { error: idsErr } = await supabase
      .from("ids")
      .update({ salemanager })
      .eq("appeal_id", appealNumber);

    if (idsErr) {
      console.error("[appeals-deadlines/loadingManager] ids update:", idsErr.message);
    } else {
      console.log(`[appeals-deadlines/loadingManager] ids.salemanager=${salemanager} для ${appealNumber}`);
    }
  } catch (err) {
    console.error("[appeals-deadlines/loadingManager] ids:", err.message);
  }

  if (!SALARY_SALES_MANAGERS.includes(salemanager)) {
    console.log(`[appeals-deadlines/loadingManager] salary skip для ${salemanager}`);
    return;
  }

  const table = SALARY_TABLE[salemanager];
  if (!table) return;

  const record = {
    appeal_id: appealNumber,
    measurement_date: getMskTodayDate(),
    product_type: appeal.product_type || null,
    status: "в погрузке",
    comment: "Отправлено на замер",
  };

  try {
    const { error: salaryErr } = await supabase.from(table).insert(record);
    if (salaryErr) {
      console.error(`[appeals-deadlines/loadingManager] ${table} insert:`, salaryErr.message);
    } else {
      console.log(`[appeals-deadlines/loadingManager] salary запись в ${table} для ${appealNumber}`);
    }
  } catch (err) {
    console.error("[appeals-deadlines/loadingManager] salary:", err.message);
  }
}

module.exports = { updateManagerRecords };
