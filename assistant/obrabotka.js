// ============================================================================
// «Понять → умение» — общий путь запроса к боту для Telegram и CRM (PLANS/CRM/18-neyrobot-na-glavnoy, буква Б).
// Вынесен из assistant/index.js дословно: Telegram и CRM идут одним кодом — «ровно таким же».
// ctx собирает вызывающий: buildContext (Telegram) или assistant/crm.js (CRM).
// ============================================================================

const { getIntent } = require("./registry");
const { classifyIntent, isActionableClassification } = require("./router");
const { detectPermissionGap } = require("./permissionHints");
const { REPLIES, buildPermissionReply, ADMIN_TELEGRAM_USERNAME } = require("./config");

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

async function obrabotatZapros(ctx) {
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
    chat: ctx.chat,
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
}

module.exports = { obrabotatZapros };
