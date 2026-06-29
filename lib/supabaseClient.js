/**
 * Единый Supabase-клиент для sunrayserver-main.
 * Ключи ТОЛЬКО из секретов Render:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 */
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const USING_SERVICE_ROLE = Boolean(SUPABASE_SERVICE_ROLE_KEY);
const SERVER_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

let bootLogged = false;

function logSupabaseBoot() {
  if (bootLogged) return;
  bootLogged = true;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error(
      "[supabase] ❌ Задайте SUPABASE_URL и SUPABASE_ANON_KEY в секретах Render.",
    );
    return;
  }

  console.log(
    `[supabase] env OK — URL задан, anon задан, серверный клиент: ${USING_SERVICE_ROLE ? "service_role" : "anon"}.`,
  );

  if (!USING_SERVICE_ROLE) {
    console.warn(
      "[supabase] ⚠️ SUPABASE_SERVICE_ROLE_KEY не задан — RLS может блокировать tasks/reminder и др.",
    );
  }
}

function createSupabaseClient(key, label) {
  if (!SUPABASE_URL || !key) {
    console.error(`[supabase] клиент «${label}» не создан: нет URL или ключа.`);
    return createClient("https://placeholder.invalid", "placeholder");
  }
  return createClient(SUPABASE_URL, key);
}

const supabase = createSupabaseClient(SERVER_KEY, "server");
const supabaseAnon = createSupabaseClient(SUPABASE_ANON_KEY, "anon");

module.exports = {
  supabase,
  supabaseAnon,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  USING_SERVICE_ROLE,
  logSupabaseBoot,
};
