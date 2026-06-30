// ============================================================================
// Триггер: когда сообщение адресовано боту (@mention в группе, любой текст в private).
// Reply на сообщение бота БЕЗ @mention — не вызов (иначе срабатывает на ответы к отбивкам).
// ============================================================================

const { getTelegramBot } = require("../tgwebhook/bot");

let botUser = null;
let botUserPromise = null;

function setBotUser(me) {
  if (!me) return;
  botUser = {
    id: me.id,
    username: me.username ? String(me.username).toLowerCase() : null,
    isBot: me.is_bot === true,
  };
}

function getBotUser() {
  return botUser;
}

/** Ленивая загрузка @username бота — без неё в группах @mention не распознаётся. */
async function ensureBotUser() {
  if (botUser) return botUser;

  const bot = getTelegramBot();
  if (!bot) return null;

  if (!botUserPromise) {
    botUserPromise = bot
      .getMe()
      .then((me) => {
        setBotUser(me);
        console.log(`[assistant/trigger] botUser загружен: @${me.username} (id=${me.id})`);
        return botUser;
      })
      .catch((error) => {
        botUserPromise = null;
        console.error("[assistant/trigger] getMe() не удался:", error.message);
        return null;
      });
  }

  return botUserPromise;
}

function isBotCommand(text) {
  const first = String(text || "").trim().split(/\s+/)[0] || "";
  return first.startsWith("/");
}

function entityMentionsBot(entity, text, bot) {
  if (!entity || !bot) return false;
  if (entity.type === "mention" && bot.username) {
    const mention = String(text || "")
      .slice(entity.offset, entity.offset + entity.length)
      .replace(/^@/, "")
      .toLowerCase();
    return mention === bot.username;
  }
  if (entity.type === "text_mention" && entity.user?.id != null) {
    return Number(entity.user.id) === Number(bot.id);
  }
  return false;
}

function messageMentionsBot(msg, bot) {
  if (!bot) return false;
  const text = msg.text || msg.caption || "";

  if (msg?.entities?.length) {
    if (msg.entities.some((entity) => entityMentionsBot(entity, text, bot))) {
      return true;
    }
  }

  // Запасной путь: @username в тексте (если entities пришли криво).
  if (bot.username && text) {
    const pattern = new RegExp(`@${bot.username}\\b`, "i");
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Сообщение адресовано боту?
 * - private: любой не-командный текст
 * - group/supergroup: только явный @mention (reply на бота без mention — игнор)
 */
async function shouldHandle(msg) {
  if (!msg || msg.from?.is_bot) return { ok: false, reason: "bot_or_empty" };

  const text = (msg.text || msg.caption || "").trim();
  if (!text || isBotCommand(text)) return { ok: false, reason: "no_text_or_command" };

  const bot = await ensureBotUser();
  const chatType = msg.chat?.type;

  if (chatType === "private") return { ok: true, bot };

  if (chatType === "group" || chatType === "supergroup") {
    if (!bot) return { ok: false, reason: "bot_user_unknown" };
    if (messageMentionsBot(msg, bot)) {
      return { ok: true, bot };
    }
    return { ok: false, reason: "no_mention" };
  }

  return { ok: false, reason: `chat_type_${chatType || "unknown"}` };
}

/** Убирает @mention бота из текста. */
function stripMention(text, bot = botUser) {
  let result = String(text || "").trim();
  if (!result || !bot?.username) return result;

  const pattern = new RegExp(`@${bot.username}\\b`, "gi");
  result = result.replace(pattern, "").replace(/\s+/g, " ").trim();
  return result;
}

module.exports = {
  setBotUser,
  getBotUser,
  ensureBotUser,
  shouldHandle,
  stripMention,
  isBotCommand,
};
