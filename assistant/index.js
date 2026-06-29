// ============================================================================
// assistant — входной AI-роутер Telegram-сообщений.
//
// Поток: trigger → telegram_bot_chats → classify intent → dispatch handle().
// ============================================================================

const { onMessage } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { getBotChat } = require("../lib/telegramBotChats");
const { resolveProfileIdByTelegramUser } = require("../tasks/directory");
const { shouldHandle, stripMention, setBotUser } = require("./trigger");
const { getEnabledIntents, getIntent } = require("./registry");
const { classifyIntent, isActionableClassification } = require("./router");
const { sendUnknown, sendError, sendAiDisabled } = require("./reply");
const { MAX_INPUT_CHARS } = require("./config");

const RECENT_MSG_MAX = 500;
const recentMsgOrder = [];
const recentMsgSet = new Set();

function isDuplicateAssistantMessage(chatId, messageId) {
  if (chatId == null || messageId == null) return false;
  const key = `${chatId}:${messageId}`;
  if (recentMsgSet.has(key)) return true;
  recentMsgSet.add(key);
  recentMsgOrder.push(key);
  if (recentMsgOrder.length > RECENT_MSG_MAX) {
    const old = recentMsgOrder.shift();
    recentMsgSet.delete(old);
  }
  return false;
}

async function buildContext(msg, bot) {
  const chatId = msg.chat?.id;
  if (chatId == null) return { ctx: null, reason: "no_chat_id" };

  const chat = await getBotChat(chatId);
  if (!chat) {
    return {
      ctx: null,
      reason: `chat_not_in_registry:${chatId}`,
    };
  }

  const enabledIntents = getEnabledIntents(chat.permissions);
  if (!enabledIntents.length) {
    return { ctx: null, reason: "no_enabled_intents" };
  }

  const rawText = (msg.text || msg.caption || "").trim();
  const text = stripMention(rawText, bot).slice(0, MAX_INPUT_CHARS);
  if (!text) return { ctx: null, reason: "empty_after_mention_strip" };

  // Текст и автор сообщения, на которое ответил менеджер (не сообщение бота).
  const replyMsg = msg.reply_to_message;
  const replyFrom =
    replyMsg && !replyMsg.from?.is_bot ? replyMsg.from : null;
  const replyText =
    replyFrom
      ? (replyMsg.text || replyMsg.caption || "").trim().slice(0, MAX_INPUT_CHARS) || null
      : null;

  const profileId = await resolveProfileIdByTelegramUser(msg.from);

  return {
    ctx: {
      bot: getTelegramBot(),
      chat,
      profileId,
      msg,
      text,
      replyText,
      replyFrom,
      chatId,
      enabledIntents,
    },
    reason: null,
  };
}

async function dispatchIntent(ctx, classification) {
  const intentDef = getIntent(classification.intent);
  if (!intentDef) {
    await sendUnknown(ctx.chatId);
    return;
  }

  console.log(
    `[assistant] → ${classification.intent} (${classification.confidence.toFixed(2)}): ` +
      `${classification.reason}`,
  );

  await intentDef.handle({
    ...ctx,
    classification,
  });
}

function registerAssistant() {
  onMessage(async (msg) => {
    const chatId = msg.chat?.id;
    const preview = (msg.text || msg.caption || "").slice(0, 60);

    const trigger = await shouldHandle(msg);
    if (!trigger.ok) {
      // Шум только если в тексте есть @ — иначе в группе слишком много сообщений.
      if (preview.includes("@")) {
        console.log(
          `[assistant] пропуск chat=${chatId}: ${trigger.reason}, text="${preview}"`,
        );
      }
      return;
    }

    if (isDuplicateAssistantMessage(chatId, msg.message_id)) {
      console.log(`[assistant] дубль message chat=${chatId} msg=${msg.message_id}`);
      return;
    }

    try {
      const { ctx, reason } = await buildContext(msg, trigger.bot);
      if (!ctx) {
        console.log(
          `[assistant] нет контекста chat=${chatId}: ${reason}, text="${preview}"`,
        );
        return;
      }

      console.log(
        `[assistant] вход: chat «${ctx.chat.title}» (${ctx.chatId}), ` +
          `profile=${ctx.profileId || "null"}, tgUser=${msg.from?.id}, ` +
          `intents=[${ctx.enabledIntents.map((i) => i.name).join(",")}], ` +
          `text="${ctx.text.slice(0, 80)}${ctx.text.length > 80 ? "…" : ""}"`,
      );

      const classification = await classifyIntent(ctx.text, ctx.enabledIntents);

      if (classification.aiDisabled) {
        await sendAiDisabled(ctx.chatId);
        return;
      }

      if (!isActionableClassification(classification)) {
        console.log(
          `[assistant] unknown/low confidence: intent=${classification.intent}, ` +
            `confidence=${classification.confidence}`,
        );
        await sendUnknown(ctx.chatId);
        return;
      }

      await dispatchIntent(ctx, classification);
    } catch (error) {
      console.error("[assistant] ошибка обработки:", error.message);
      const chatId = msg.chat?.id;
      if (chatId != null) {
        try {
          await sendError(chatId);
        } catch (replyError) {
          console.error("[assistant] не удалось отправить ошибку:", replyError.message);
        }
      }
    }
  });

  console.log("[assistant] AI-роутер зарегистрирован");
}

async function startAssistant() {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[assistant] telegramBot ещё не установлен — botUser не загружен");
    return;
  }

  try {
    const me = await bot.getMe();
    setBotUser(me);
    console.log(
      `[assistant] botUser: @${me.username || "—"} (id=${me.id})`,
    );
  } catch (error) {
    console.error("[assistant] getMe() не удался:", error.message);
  }
}

module.exports = {
  registerAssistant,
  startAssistant,
};
