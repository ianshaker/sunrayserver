// ============================================================================
// Ростер менеджеров для промпта создания задачи.
// Gemini видит список (id, имя, @ник) и возвращает extra_assignee_id, если
// сотрудник упомянул кого-то кроме себя как исполнителя.
// ============================================================================

const { supabase } = require("../supabaseClient");

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

let cache = { profiles: [], loadedAt: 0 };

async function loadRoster() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, telegram_username")
    .order("full_name");

  if (error) {
    console.error("[tasks/create/roster] загрузка:", error.message);
    return cache.profiles;
  }

  cache = {
    profiles: (data || []).filter((p) => p.full_name?.trim()),
    loadedAt: Date.now(),
  };
  return cache.profiles;
}

async function getRoster() {
  if (!cache.loadedAt || Date.now() - cache.loadedAt > CACHE_TTL_MS) {
    await loadRoster();
  }
  return cache.profiles;
}

/**
 * Строит компактный текстовый список для системного промпта Gemini.
 * Формат: id | имя | @ник (или «нет»)
 */
async function buildRosterText() {
  const profiles = await getRoster();
  if (!profiles.length) return "Список сотрудников пуст.";
  return profiles
    .map((p) => `- id:${p.id} | ${p.full_name}${p.telegram_username ? ` | @${p.telegram_username}` : ""}`)
    .join("\n");
}

/**
 * Проверяет, что id действительно есть в ростере (защита от галлюцинаций Gemini).
 */
async function validateAssigneeId(id) {
  if (!id) return false;
  const profiles = await getRoster();
  return profiles.some((p) => p.id === id);
}

module.exports = { getRoster, buildRosterText, validateAssigneeId };
