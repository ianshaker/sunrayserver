// ============================================================================
// Парсер задачи через Gemini (этап 2): текст → {title, description, время}.
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION } = require("./config");
const { buildParsePrompt, buildParseUserPrompt } = require("./prompts");
const { nowMskString, mskLocalToUtcIso } = require("./time");

function parseModelJson(raw) {
  if (!raw) return null;
  let jsonStr = raw.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

function clarification(message) {
  return { status: "need_clarification", clarification: message };
}

/**
 * @returns {Promise<
 *   | { status: "ok", title, description, dueDateUtc, dueDateMskLocal }
 *   | { status: "need_clarification", clarification }
 *   | { status: "error", error }
 * >}
 */
async function parseTaskMessage(text) {
  if (!text || !text.trim()) {
    return clarification("Пустое сообщение. Напишите, что и на когда напомнить.");
  }
  if (!hasCredentials()) {
    return { status: "error", error: "ai_disabled" };
  }

  const systemPrompt = buildParsePrompt(nowMskString());
  const userPrompt = buildParseUserPrompt(text);

  const { text: raw, finishReason } = await generateContent({
    systemPrompt,
    userPrompt,
    model: GEMINI_MODEL,
    location: VERTEX_LOCATION,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  if (!raw) {
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    return { status: "error", error: "parse_failed" };
  }

  if (parsed.status === "need_clarification") {
    return clarification(
      String(parsed.clarification || "").trim() ||
        "Уточните, пожалуйста, что и на когда поставить напоминание.",
    );
  }

  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();
  const dueDateMskLocal = parsed.due_date_msk ? String(parsed.due_date_msk).trim() : null;

  if (!title) {
    return clarification("Не понял суть задачи. Сформулируйте, что нужно сделать.");
  }
  if (!dueDateMskLocal) {
    return clarification("Не понял, на когда напомнить. Укажите дату и время.");
  }

  const dueDateUtc = mskLocalToUtcIso(dueDateMskLocal);
  if (!dueDateUtc) {
    return clarification("Не разобрал дату. Напишите время яснее, например «завтра в 14:00».");
  }

  // Серверная страховка от прошлого времени (на случай, если модель не заметила).
  if (new Date(dueDateUtc).getTime() <= Date.now()) {
    return clarification("Это время уже прошло. Укажите будущие дату и время.");
  }

  return {
    status: "ok",
    title,
    description,
    dueDateUtc,
    dueDateMskLocal,
  };
}

module.exports = { parseTaskMessage };
