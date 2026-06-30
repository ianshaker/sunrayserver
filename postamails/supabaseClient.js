const {
  supabase,
  USING_SERVICE_ROLE,
  logSupabaseBoot,
} = require("../lib/supabaseClient");

logSupabaseBoot();

console.log(
  `[postamails] Supabase: ${USING_SERVICE_ROLE ? "service_role" : "anon"} (gmail_oauth_tokens, gmail_processed_messages, appeals).`,
);

module.exports = { supabase, USING_SERVICE_ROLE };
