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
const { sendUnknown, sendError, sendAiDisabled, sendPermissionDenied, sendText } = require("./reply");
const { detectPermissionGap } = require("./permissionHints");
const { MAX_INPUT_CHARS } = require("./config");
const { extractReplyContext, labelUnsupportedKind } = require("./replyExtract");

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
      chat: null,
    };
  }

  const enabledIntents = getEnabledIntents(chat.permissions);
  if (!enabledIntents.length) {
    return { ctx: null, reason: "no_enabled_intents", chat };
  }

  const rawText = (msg.text || msg.caption || "").trim();
  const textFromMsg = stripMention(rawText, bot).slice(0, MAX_INPUT_CHARS);

  const { replyText, replyFrom, replyUnsupported, replyVoiceFailed } =
    await extractReplyContext(msg.reply_to_message, getTelegramBot());
  if (replyUnsupported) {
    console.log(
      `[assistant] reply без текста (${labelUnsupportedKind(replyUnsupported)}) — контекст не используем`,
    );
  }

  // Если текст команды пустой (@бот без слов), но голосовое reply расшифровалось —
  // используем транскрипт как основной текст (голосовое — полноценная команда).
  let text = textFromMsg;
  let voiceAsText = false;
  if (!text && replyText && msg.reply_to_message?.voice) {
    text = replyText;
    voiceAsText = true;
    console.log(`[assistant] голосовое → основной текст команды: "${text.slice(0, 80)}"`);
  }

  if (!text) return { ctx: null, reason: "empty_after_mention_strip" };

  const profileId = await resolveProfileIdByTelegramUser(msg.from);

  return {
    ctx: {
      bot: getTelegramBot(),
      chat,
      profileId,
      msg,
      text,
      replyText: voiceAsText ? null : replyText,
      replyFrom: voiceAsText ? null : replyFrom,
      replyUnsupported,
      replyVoiceFailed,
      chatId,
      enabledIntents,
    },
    reason: null,
    chat,
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
      const { ctx, reason, chat: chatEntry } = await buildContext(msg, trigger.bot);
      if (!ctx) {
        console.log(
          `[assistant] нет контекста chat=${chatId}: ${reason}, text="${preview}"`,
        );
        const rawText = stripMention((msg.text || msg.caption || "").trim(), trigger.bot);
        const gap = detectPermissionGap({
          chat: chatEntry,
          text: rawText,
          contextReason: reason,
        });
        if (gap) {
          await sendPermissionDenied(chatId, gap);
        }
        return;
      }

      console.log(
        `[assistant] вход: chat «${ctx.chat.title}» (${ctx.chatId}), ` +
          `profile=${ctx.profileId || "null"}, tgUser=${msg.from?.id}, ` +
          `intents=[${ctx.enabledIntents.map((i) => i.name).join(",")}], ` +
          `text="${ctx.text.slice(0, 80)}${ctx.text.length > 80 ? "…" : ""}"`,
      );

      // Уведомляем, если голосовое было, но не расшифровалось.
      if (ctx.replyVoiceFailed) {
        try {
          await sendText(
            ctx.chatId,
            `⚠️ Голосовое не взял в контекст — ${ctx.replyVoiceFailed}. Работаю только с текстом команды.`,
          );
        } catch (_) {}
      }

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
        const gap = detectPermissionGap({
          chat: ctx.chat,
          text: ctx.text,
          classification,
        });
        if (gap) {
          await sendPermissionDenied(chatId, gap);
        } else {
          await sendUnknown(chatId);
        }
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
