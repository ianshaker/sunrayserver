const {
  supabase,
  SUPABASE_URL,
  logSupabaseBoot,
} = require("../lib/supabaseClient");

logSupabaseBoot();

module.exports = { supabase, SUPABASE_URL };
