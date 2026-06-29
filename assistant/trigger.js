// ============================================================================
// Триггер: когда сообщение адресовано боту (упоминание, reply, private).
// ============================================================================

let botUser = null;

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
  if (!bot || !msg?.entities?.length) return false;
  const text = msg.text || msg.caption || "";
  return msg.entities.some((entity) => entityMentionsBot(entity, text, bot));
}

function isReplyToBot(msg, bot) {
  if (!bot || !msg?.reply_to_message) return false;
  const replyFrom = msg.reply_to_message.from;
  if (!replyFrom) return false;
  return Number(replyFrom.id) === Number(bot.id);
}

/**
 * Сообщение адресовано боту?
 * - private: любой не-командный текст
 * - group/supergroup: @mention или reply на сообщение бота
 */
function shouldHandle(msg, bot = botUser) {
  if (!msg || msg.from?.is_bot) return false;

  const text = (msg.text || msg.caption || "").trim();
  if (!text || isBotCommand(text)) return false;

  const chatType = msg.chat?.type;
  if (chatType === "private") return true;

  if (chatType === "group" || chatType === "supergroup") {
    return messageMentionsBot(msg, bot) || isReplyToBot(msg, bot);
  }

  return false;
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
  shouldHandle,
  stripMention,
  isBotCommand,
};
