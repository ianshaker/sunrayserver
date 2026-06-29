// ============================================================================
// Парсер задачи через Gemini (этап 2): текст → {title, description, время}.
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION } = require("./config");
const { buildParsePrompt, buildParseUserPrompt } = require("./prompts");
const { nowMskString, mskLocalToUtcIso } = require("./time");
const { buildRosterText, validateAssigneeId } = require("./assigneeRoster");

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

function rejection(reason) {
  return { status: "rejected", reason };
}

/**
 * @returns {Promise<
 *   | { status: "ok", title, description, dueDateUtc, dueDateMskLocal, extraAssigneeId: string|null }
 *   | { status: "rejected", reason }
 *   | { status: "error", error }
 * >}
 */
async function parseTaskMessage(text) {
  if (!text || !text.trim()) {
    return rejection("Пустое сообщение — укажите, что сделать и на когда напомнить.");
  }
  if (!hasCredentials()) {
    console.log("[tasks/create/parser] AI недоступен (нет credentials)");
    return { status: "error", error: "ai_disabled" };
  }

  console.log(`[tasks/create/parser] запрос Gemini, длина=${text.trim().length}`);

  const rosterText = await buildRosterText();
  const systemPrompt = buildParsePrompt(nowMskString(), rosterText);
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
    console.log(`[tasks/create/parser] пустой ответ Gemini: finish=${finishReason || "?"}`);
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.log("[tasks/create/parser] JSON не разобран");
    return { status: "error", error: "parse_failed" };
  }

  // rejected или legacy need_clarification от модели — без диалога, только отказ.
  if (parsed.status === "rejected" || parsed.status === "need_clarification") {
    const reason =
      String(parsed.reason || parsed.clarification || "").trim() ||
      "Не удалось однозначно разобрать дату и время.";
    return rejection(reason);
  }

  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();
  const dueDateMskLocal = parsed.due_date_msk ? String(parsed.due_date_msk).trim() : null;

  if (!title) {
    return rejection("Не понятна суть задачи — опишите, что нужно сделать.");
  }
  if (!dueDateMskLocal) {
    return rejection("Не указаны дата и время напоминания.");
  }

  const dueDateUtc = mskLocalToUtcIso(dueDateMskLocal);
  if (!dueDateUtc) {
    return rejection(
      "Не удалось разобрать дату — укажите явно, например «завтра в 14:00» или «завтра в 10 утра».",
    );
  }

  if (new Date(dueDateUtc).getTime() <= Date.now()) {
    return rejection("Указанное время уже прошло — укажите будущие дату и время.");
  }

  // Доп. исполнитель — валидируем id против ростера (защита от галлюцинаций).
  const rawExtraId = parsed.extra_assignee_id ? String(parsed.extra_assignee_id).trim() : null;
  const extraAssigneeId =
    rawExtraId && (await validateAssigneeId(rawExtraId)) ? rawExtraId : null;

  if (rawExtraId && !extraAssigneeId) {
    console.log(`[tasks/create/parser] extra_assignee_id "${rawExtraId}" не найден в ростере — игнорируем`);
  }

  return {
    status: "ok",
    title,
    description,
    dueDateUtc,
    dueDateMskLocal,
    extraAssigneeId,
  };
}

module.exports = { parseTaskMessage };
