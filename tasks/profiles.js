const { supabase } = require("./supabaseClient");

async function loadProfilesByIds(userIds) {
  if (!userIds.length) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, telegram_username, telegram_user_id")
    .in("id", userIds);

  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.id, profile]));
}

module.exports = { loadProfilesByIds };
