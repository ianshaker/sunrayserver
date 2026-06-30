// ============================================================================
// assistant — входной AI-роутер Telegram-сообщений.
//
// Поток: trigger → telegram_bot_chats → classify intent → dispatch handle().
// Статусное сообщение (StatusMessage) обновляется по ходу обработки:
//   "Вижу..." → "Расшифровываю..." (голос) → "Думаю..." → превью с кнопками.
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
const { MAX_INPUT_CHARS, REPLIES, buildPermissionReply, ADMIN_TELEGRAM_USERNAME } = require("./config");
const { extractReplyContext, labelUnsupportedKind } = require("./replyExtract");
const { StatusMessage } = require("./statusMessage");

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
    return { ctx: null, reason: `chat_not_in_registry:${chatId}`, chat: null };
  }

  const enabledIntents = getEnabledIntents(chat.permissions);
  if (!enabledIntents.length) {
    return { ctx: null, reason: "no_enabled_intents", chat };
  }

  const rawText = (msg.text || msg.caption || "").trim();
  const textFromMsg = stripMention(rawText, bot).slice(0, MAX_INPUT_CHARS);

  const replyMsg = msg.reply_to_message;
  const hasVoiceReply = !!(replyMsg && !replyMsg.from?.is_bot && replyMsg.voice);

  if (!textFromMsg && !hasVoiceReply) {
    return { ctx: null, reason: "empty_after_mention_strip" };
  }

  // Статусное сообщение — reply на команду менеджера.
  const tgBot = getTelegramBot();
  const statusMsg = new StatusMessage(tgBot, chatId, msg.message_id);
  await statusMsg.send("⏳ Вижу меня отметили, изучаю запрос...");

  // Голосовой reply: обновляем статус до начала расшифровки.
  if (hasVoiceReply) {
    await statusMsg.update("🎙 Расшифровываю голосовое...");
  }

  const { replyText, replyFrom, replyUnsupported, replyVoiceFailed } =
    await extractReplyContext(replyMsg, tgBot);

  if (replyUnsupported) {
    console.log(
      `[assistant] reply без текста (${labelUnsupportedKind(replyUnsupported)}) — контекст не используем`,
    );
  }

  // Если текст команды пустой, но голосовое расшифровалось — голос = команда.
  let text = textFromMsg;
  let voiceAsText = false;
  if (!text && replyText && hasVoiceReply) {
    text = replyText;
    voiceAsText = true;
    console.log(`[assistant] голосовое → основной текст команды: "${text.slice(0, 80)}"`);
  }

  if (!text) {
    // Только @бот + голосовое reply, но расшифровка не удалась.
    const label = replyVoiceFailed || "нет текста";
    await statusMsg.update(`❌ Не удалось расшифровать голосовое — ${label}.\nПришлите команду текстом.`);
    return { ctx: null, reason: "empty_after_mention_strip" };
  }

  const profileId = await resolveProfileIdByTelegramUser(msg.from);

  return {
    ctx: {
      bot: tgBot,
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
      statusMsg,
    },
    reason: null,
    chat,
  };
}

async function dispatchIntent(ctx, classification) {
  const intentDef = getIntent(classification.intent);
  if (!intentDef) {
    await ctx.statusMsg.update(REPLIES.UNKNOWN);
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

    let ctx = null;
    try {
      const { ctx: builtCtx, reason, chat: chatEntry } = await buildContext(msg, trigger.bot);
      if (!builtCtx) {
        console.log(
          `[assistant] нет контекста chat=${chatId}: ${reason}, text="${preview}"`,
        );
        // Статусное сообщение уже обновлено внутри buildContext (если было отправлено).
        // Для permission-gap без статуса — отдельный ответ.
        const rawText = stripMention((msg.text || msg.caption || "").trim(), trigger.bot);
        const gap = detectPermissionGap({
          chat: chatEntry,
          text: rawText,
          contextReason: reason,
        });
        if (gap && reason !== "empty_after_mention_strip") {
          await sendPermissionDenied(chatId, gap);
        }
        return;
      }

      ctx = builtCtx;

      console.log(
        `[assistant] вход: chat «${ctx.chat.title}» (${ctx.chatId}), ` +
          `profile=${ctx.profileId || "null"}, tgUser=${msg.from?.id}, ` +
          `intents=[${ctx.enabledIntents.map((i) => i.name).join(",")}], ` +
          `text="${ctx.text.slice(0, 80)}${ctx.text.length > 80 ? "…" : ""}"` +
          (ctx.replyText ? ` replyCtx="${ctx.replyText.slice(0, 60)}…"` : ""),
      );

      // Обновляем статус перед вызовом Gemini (роутер + парсер).
      // Если голосовое не расшифровалось — показываем предупреждение в той же строке.
      if (ctx.replyVoiceFailed) {
        await ctx.statusMsg.update(
          `⚠️ Голосовое не взял в контекст — ${ctx.replyVoiceFailed}.\n💭 Думаю над запросом...`,
        );
      } else {
        await ctx.statusMsg.update("💭 Думаю над запросом...");
      }

      const classification = await classifyIntent(ctx.text, ctx.enabledIntents, {
        replyText: ctx.replyText,
      });

      if (classification.aiDisabled) {
        await ctx.statusMsg.update(REPLIES.AI_DISABLED);
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
        const errText = gap
          ? buildPermissionReply(gap, ADMIN_TELEGRAM_USERNAME)
          : REPLIES.UNKNOWN;
        await ctx.statusMsg.update(errText || REPLIES.UNKNOWN);
        return;
      }

      await dispatchIntent(ctx, classification);
    } catch (error) {
      console.error("[assistant] ошибка обработки:", error.message);
      if (chatId != null) {
        try {
          if (ctx?.statusMsg?.messageId) {
            await ctx.statusMsg.update(REPLIES.ERROR);
          } else {
            await sendError(chatId);
          }
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
