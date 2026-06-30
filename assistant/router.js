// ============================================================================
// Классификация интента через Gemini (этап 1).
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const {
  GEMINI_MODEL,
  VERTEX_LOCATION,
  CONFIDENCE_THRESHOLD,
} = require("./config");
const { buildRouterPrompt, buildRouterUserPrompt } = require("./prompts");
const { getIntent } = require("./registry");

function parseRouterResponse(raw, enabledIntents) {
  const allowed = new Set(enabledIntents.map((i) => i.name));
  allowed.add("unknown");

  const fallback = {
    intent: "unknown",
    confidence: 0,
    reason: "Не удалось разобрать ответ модели",
  };

  if (!raw) return fallback;

  let jsonStr = raw.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const intent = String(parsed.intent || "unknown").trim();
    const confidence = Number(parsed.confidence);
    const reason = String(parsed.reason || "").trim() || fallback.reason;

    if (!allowed.has(intent)) {
      return { intent: "unknown", confidence: 0, reason: `Неизвестный intent: ${intent}` };
    }

    return {
      intent,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      reason,
    };
  } catch (_) {
    return fallback;
  }
}

function tryDeadlineReplyRoute(text, replyText, enabledIntents) {
  const allowed = enabledIntents.some((i) => i.name === "appeal_deadline_manage");
  if (!allowed || !replyText) return null;

  const isDeadlineCard = /ДЕДЛАЙН\s*#?\d{5}/i.test(replyText) || /#\d{5}/.test(replyText);
  if (!isDeadlineCard) return null;

  if (!/перенес|перенос|дедлайн|отказ|погруз|инфо/i.test(text)) return null;

  return {
    intent: "appeal_deadline_manage",
    confidence: 0.96,
    reason: "Reply на карточку дедлайна входящей заявки",
  };
}

/**
 * @returns {Promise<{ intent: string, confidence: number, reason: string, aiDisabled?: boolean }>}
 */
async function classifyIntent(text, enabledIntents, { replyText } = {}) {
  if (!enabledIntents.length) {
    return { intent: "unknown", confidence: 0, reason: "Нет доступных интентов для чата" };
  }

  const fast = tryDeadlineReplyRoute(text, replyText, enabledIntents);
  if (fast) {
    console.log(
      `[assistant/router] fast-path ${fast.intent} conf=${fast.confidence.toFixed(2)} reason="${fast.reason}"`,
    );
    return fast;
  }

  if (!hasCredentials()) {
    return { intent: "unknown", confidence: 0, reason: "AI недоступен", aiDisabled: true };
  }

  const systemPrompt = buildRouterPrompt(enabledIntents);
  const userPrompt = buildRouterUserPrompt(text, replyText);

  const { text: raw, finishReason } = await generateContent({
    systemPrompt,
    userPrompt,
    model: GEMINI_MODEL,
    location: VERTEX_LOCATION,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  if (!raw) {
    const empty = {
      intent: "unknown",
      confidence: 0,
      reason: finishReason === "MAX_TOKENS" ? "Ответ модели обрезан" : "Пустой ответ модели",
    };
    console.log(`[assistant/router] пустой ответ модели: finish=${finishReason || "?"}`);
    return empty;
  }

  const result = parseRouterResponse(raw, enabledIntents);
  console.log(
    `[assistant/router] intent=${result.intent} conf=${result.confidence.toFixed(2)} ` +
      `reason="${result.reason}"`,
  );
  return result;
}

function isActionableClassification(result) {
  if (!result || result.intent === "unknown") return false;
  if (result.confidence < CONFIDENCE_THRESHOLD) return false;
  return Boolean(getIntent(result.intent));
}

module.exports = {
  classifyIntent,
  isActionableClassification,
  CONFIDENCE_THRESHOLD,
};
