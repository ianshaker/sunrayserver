// ============================================================================
// Справочник Telegram-личности сотрудников — из profiles (Supabase).
//
// Единый источник правды вместо захардкоженного маппинга:
//   - chat_id   → куда слать уведомления
//   - username  → первичная привязка
//   - user_id   → стабильная проверка прав на кнопки
//
// chat_id кэшируется в памяти (обновляется при старте и раз в 5 мин), чтобы
// горячий путь уведомлений не дёргал БД на каждое сообщение. Проверка прав
// (resolveProfileIdByTelegramUser) ходит в БД напрямую — это редкое событие
// и должно быть максимально свежим.
// ============================================================================

const { supabase } = require("./supabaseClient");

let cache = { byUser: new Map(), loadedAt: 0 };

function normalizeUsername(value) {
  if (!value) return null;
  const clean = String(value).replace(/^@/, "").trim().toLowerCase();
  return clean || null;
}

async function reloadDirectory() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, telegram_user_id, telegram_username, telegram_chat_id");

  if (error) {
    console.error("[tasks/directory] загрузка профилей:", error.message);
    return cache;
  }

  const byUser = new Map();
  for (const profile of data || []) {
    byUser.set(profile.id, {
      chatId:
        profile.telegram_chat_id != null ? Number(profile.telegram_chat_id) : null,
      username: normalizeUsername(profile.telegram_username),
      tgUserId:
        profile.telegram_user_id != null ? Number(profile.telegram_user_id) : null,
    });
  }

  cache = { byUser, loadedAt: Date.now() };
  console.log(`[tasks/directory] профилей в кэше: ${byUser.size}`);
  return cache;
}

async function ensureDirectory() {
  if (!cache.loadedAt) await reloadDirectory();
  return cache;
}

/** Синхронный доступ к chat_id из кэша (после ensureDirectory). */
function getChatIdForUserSync(userId) {
  return cache.byUser.get(userId)?.chatId ?? null;
}

/** Асинхронный безопасный доступ — гарантирует, что кэш загружен. */
async function getChatIdForUser(userId) {
  await ensureDirectory();
  return getChatIdForUserSync(userId);
}

/**
 * Кто нажал кнопку → какой это профиль (UUID).
 * 1) по стабильному telegram_user_id;
 * 2) иначе по нику → при совпадении запоминаем telegram_user_id (автопривязка),
 *    дальше проверки идут уже по нему.
 */
async function resolveProfileIdByTelegramUser(from) {
  if (!from) return null;

  const tgUserId = from.id != null ? Number(from.id) : null;
  const uname = normalizeUsername(from.username);

  if (tgUserId != null) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("telegram_user_id", tgUserId)
      .maybeSingle();
    if (error) console.error("[tasks/directory] поиск по user_id:", error.message);
    if (data) return data.id;
  }

  if (uname) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, telegram_user_id")
      .eq("telegram_username", uname)
      .maybeSingle();
    if (error) console.error("[tasks/directory] поиск по нику:", error.message);

    if (data) {
      if (tgUserId != null && data.telegram_user_id == null) {
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ telegram_user_id: tgUserId })
          .eq("id", data.id);
        if (updateError) {
          console.error("[tasks/directory] автопривязка user_id:", updateError.message);
        } else {
          console.log(
            `[tasks/directory] привязан telegram_user_id ${tgUserId} → профиль ${data.id} (@${uname})`,
          );
          reloadDirectory().catch(() => {});
        }
      }
      return data.id;
    }
  }

  return null;
}

function startDirectoryRefresh() {
  reloadDirectory().catch((e) =>
    console.error("[tasks/directory] первичная загрузка:", e.message),
  );
  setInterval(() => {
    reloadDirectory().catch((e) =>
      console.error("[tasks/directory] обновление:", e.message),
    );
  }, 5 * 60 * 1000);
  console.log("[tasks/directory] кэш профилей: старт + обновление каждые 5 мин");
}

module.exports = {
  reloadDirectory,
  ensureDirectory,
  getChatIdForUser,
  getChatIdForUserSync,
  resolveProfileIdByTelegramUser,
  startDirectoryRefresh,
  normalizeUsername,
};
