const { supabase, logSupabaseBoot } = require("../lib/supabaseClient");

logSupabaseBoot();

module.exports = { supabase };
