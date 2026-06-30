// ============================================================================
// Подпись менеджера для блока «бот довнёс данные».
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { normalizeUsername } = require("../tasks/directory");

/**
 * @param {string|null} profileId
 * @param {object|null} from — msg.from из Telegram
 * @returns {Promise<string>}
 */
async function resolveManagerLabel(profileId, from) {
  let fullName = null;
  let username =
    from?.username != null ? `@${normalizeUsername(from.username) || from.username}` : null;

  if (profileId) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, telegram_username")
      .eq("id", profileId)
      .maybeSingle();

    if (data?.full_name) fullName = String(data.full_name).trim();
    if (!username && data?.telegram_username) {
      username = `@${normalizeUsername(data.telegram_username)}`;
    }
  }

  const parts = [username, fullName].filter(Boolean);
  return parts.length ? parts.join(", ") : "менеджер";
}

module.exports = { resolveManagerLabel };
