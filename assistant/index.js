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

async function buildContext(msg) {
  const chatId = msg.chat?.id;
  if (chatId == null) return null;

  const chat = await getBotChat(chatId);
  if (!chat) return null;

  const enabledIntents = getEnabledIntents(chat.permissions);
  if (!enabledIntents.length) return null;

  const rawText = (msg.text || msg.caption || "").trim();
  const text = stripMention(rawText).slice(0, MAX_INPUT_CHARS);
  if (!text) return null;

  const profileId = await resolveProfileIdByTelegramUser(msg.from);

  return {
    bot: getTelegramBot(),
    chat,
    profileId,
    msg,
    text,
    chatId,
    enabledIntents,
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
    if (!shouldHandle(msg)) return;

    try {
      const ctx = await buildContext(msg);
      if (!ctx) return;

      console.log(
        `[assistant] вход: chat «${ctx.chat.title}» (${ctx.chatId}), ` +
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
