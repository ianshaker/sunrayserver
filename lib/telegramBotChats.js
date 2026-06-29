// ============================================================================
// Реестр разрешённых Telegram-чатов (таблица telegram_bot_chats).
//
// Одна таблица на все отделы: создание задач, расписание мастеров и т.д.
// Кэш в памяти (старт + раз в час) — чаты меняются редко; горячий путь
// не бьёт БД на каждое сообщение. reloadBotChats() — для ручного сброса.
// ============================================================================

const { supabase } = require("./supabaseClient");

/** Ключи прав — расширяем по мере новых фич бота. */
const PERMISSIONS = Object.freeze({
  TASK_CREATE: "task_create",
  TASK_ACTIONS: "task_actions",
  MASTER_SCHEDULE: "master_schedule",
});

/** Реестр чатов почти статичен — час достаточно; CRM позже может дернуть reloadBotChats(). */
const REFRESH_MS = 60 * 60 * 1000;

let cache = { byChatId: new Map(), loadedAt: 0 };

function normalizeChatId(chatId) {
  if (chatId == null) return null;
  const n = Number(chatId);
  return Number.isFinite(n) ? n : null;
}

function rowToEntry(row) {
  return {
    id: row.id,
    chatId: Number(row.chat_id),
    title: row.title,
    profileId: row.profile_id,
    kind: row.kind,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    isActive: row.is_active !== false,
  };
}

async function reloadBotChats() {
  const { data, error } = await supabase
    .from("telegram_bot_chats")
    .select("id, chat_id, title, profile_id, kind, permissions, is_active")
    .eq("is_active", true);

  if (error) {
    console.error("[telegramBotChats] загрузка:", error.message);
    return cache;
  }

  const byChatId = new Map();
  for (const row of data || []) {
    const entry = rowToEntry(row);
    byChatId.set(entry.chatId, entry);
  }

  cache = { byChatId, loadedAt: Date.now() };
  console.log(`[telegramBotChats] активных чатов в кэше: ${byChatId.size}`);
  return cache;
}

async function ensureBotChats() {
  if (!cache.loadedAt) await reloadBotChats();
  return cache;
}

function getBotChatSync(chatId) {
  const id = normalizeChatId(chatId);
  if (id == null) return null;
  return cache.byChatId.get(id) ?? null;
}

async function getBotChat(chatId) {
  await ensureBotChats();
  return getBotChatSync(chatId);
}

function chatHasPermissionSync(chatId, permission) {
  const chat = getBotChatSync(chatId);
  if (!chat) return false;
  return chat.permissions.includes(permission);
}

async function chatHasPermission(chatId, permission) {
  await ensureBotChats();
  return chatHasPermissionSync(chatId, permission);
}

/** Чат активен в реестре и имеет указанное право. */
async function getAuthorizedChat(chatId, permission) {
  const chat = await getBotChat(chatId);
  if (!chat) return null;
  if (!chat.permissions.includes(permission)) return null;
  return chat;
}

async function listChatsWithPermission(permission) {
  await ensureBotChats();
  return [...cache.byChatId.values()].filter((c) => c.permissions.includes(permission));
}

function startBotChatsRefresh() {
  reloadBotChats().catch((e) =>
    console.error("[telegramBotChats] первичная загрузка:", e.message),
  );
  setInterval(() => {
    reloadBotChats().catch((e) =>
      console.error("[telegramBotChats] обновление:", e.message),
    );
  }, REFRESH_MS);
  console.log("[telegramBotChats] кэш: старт + обновление каждый час");
}

module.exports = {
  PERMISSIONS,
  reloadBotChats,
  ensureBotChats,
  getBotChat,
  getBotChatSync,
  chatHasPermission,
  chatHasPermissionSync,
  getAuthorizedChat,
  listChatsWithPermission,
  startBotChatsRefresh,
};
