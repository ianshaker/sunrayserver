// ============================================================================
// Парсер команд управления задачами через Gemini (этап 2):
// текст → { action, taskNumber, dueDateUtc? }.
//
// Бизнес-правило «нет номера → отказ» решает intent.js (чтобы текст отказа был
// единым). Здесь только разбор и валидация времени для переноса.
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION, ACTIONS } = require("./config");
const { buildManagePrompt, buildManageUserPrompt } = require("./prompts");
const { nowMskString, mskLocalToUtcIso } = require("../create/time");

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

function normalizeTaskNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * @returns {Promise<
 *   | { status: "ok", action, taskNumber, dueDateUtc, dueDateMskLocal }
 *   | { status: "rejected", action, taskNumber, reason }
 *   | { status: "error", error }
 * >}
 */
async function parseManageMessage(text) {
  if (!text || !text.trim()) {
    return { status: "error", error: "empty_input" };
  }
  if (!hasCredentials()) {
    console.log("[tasks/manage/parser] AI недоступен (нет credentials)");
    return { status: "error", error: "ai_disabled" };
  }

  console.log(`[tasks/manage/parser] запрос Gemini, длина=${text.trim().length}`);

  const systemPrompt = buildManagePrompt(nowMskString());
  const userPrompt = buildManageUserPrompt(text);

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
    console.log(`[tasks/manage/parser] пустой ответ Gemini: finish=${finishReason || "?"}`);
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.log("[tasks/manage/parser] JSON не разобран");
    return { status: "error", error: "parse_failed" };
  }

  const action = String(parsed.action || "").trim();
  if (!ACTIONS.includes(action)) {
    return { status: "error", error: "unknown_action" };
  }

  const taskNumber = normalizeTaskNumber(parsed.task_number);

  // Отказ от модели (например, неоднозначное время) — пробрасываем причину.
  if (parsed.status === "rejected") {
    const reason =
      String(parsed.reason || "").trim() || "Не удалось однозначно разобрать команду.";
    return { status: "rejected", action, taskNumber, reason };
  }

  if (action !== "reschedule") {
    return { status: "ok", action, taskNumber, dueDateUtc: null, dueDateMskLocal: null };
  }

  // reschedule — нужно валидное будущее время.
  const dueDateMskLocal = parsed.due_date_msk ? String(parsed.due_date_msk).trim() : null;
  if (!dueDateMskLocal) {
    return {
      status: "rejected",
      action,
      taskNumber,
      reason: "Не указано, на какое время перенести задачу.",
    };
  }

  const dueDateUtc = mskLocalToUtcIso(dueDateMskLocal);
  if (!dueDateUtc) {
    return {
      status: "rejected",
      action,
      taskNumber,
      reason:
        "Не удалось разобрать новое время — укажите явно, например «на завтра в 14:00» или «на завтра в 10 утра».",
    };
  }

  if (new Date(dueDateUtc).getTime() <= Date.now()) {
    return {
      status: "rejected",
      action,
      taskNumber,
      reason: "Новое время уже прошло — укажите будущие дату и время.",
    };
  }

  return { status: "ok", action, taskNumber, dueDateUtc, dueDateMskLocal };
}

module.exports = { parseManageMessage };
