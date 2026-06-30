// ============================================================================
// Менеджер вывода (salemanager) — автор команды из profiles.
// Значения как в CRM: Настя | Таня | Света | Гена | Саша | Другой
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { normalizeUsername } = require("../tasks/directory");

/** Менеджеры, для которых создаётся запись в salary_* (как в CRM). */
const SALARY_SALES_MANAGERS = ["Настя", "Таня", "Света", "Гена"];

/** Ник → salemanager (миграции profiles). */
const USERNAME_TO_SALES = {
  plyushka_p: "Света",
  yaqudzo: "Гена",
  elenamira70: "Настя",
  bravekate19: "Таня",
  albalyxs: "Саша",
  dvmironova: "Другой",
};

/** Имя (lower) → salemanager. */
const FIRST_NAME_TO_SALES = {
  светлана: "Света",
  гена: "Гена",
  геннадий: "Гена",
  настя: "Настя",
  таня: "Таня",
  татьяна: "Таня",
  екатерина: "Таня",
  александра: "Саша",
  саша: "Саша",
  дарья: "Другой",
};

/**
 * @param {{ full_name?: string|null, telegram_username?: string|null }} profile
 * @returns {string}
 */
function mapProfileToSalesManager(profile) {
  const uname = normalizeUsername(profile?.telegram_username);
  if (uname && USERNAME_TO_SALES[uname]) {
    return USERNAME_TO_SALES[uname];
  }

  const full = String(profile?.full_name || "").trim();
  if (!full) return "Другой";

  const first = full.split(/\s+/)[0].toLowerCase();
  if (FIRST_NAME_TO_SALES[first]) {
    return FIRST_NAME_TO_SALES[first];
  }

  const short = full.split(/\s+/)[0];
  if (["Настя", "Таня", "Света", "Гена", "Саша", "Другой"].includes(short)) {
    return short;
  }

  return "Другой";
}

/**
 * @param {string} profileId
 * @returns {Promise<{ salemanager: string, createsSalary: boolean }>}
 */
async function resolveSalesManagerFromProfile(profileId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, telegram_username")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/salesManager] profiles:", error.message);
    return { salemanager: "Другой", createsSalary: false };
  }

  const salemanager = mapProfileToSalesManager(data || {});
  return {
    salemanager,
    createsSalary: SALARY_SALES_MANAGERS.includes(salemanager),
  };
}

module.exports = {
  SALARY_SALES_MANAGERS,
  resolveSalesManagerFromProfile,
  mapProfileToSalesManager,
};
