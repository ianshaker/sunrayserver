// ============================================================================
// Парсер команд управления задачами (этап 2):
// текст → { action, taskNumber, dueDateUtc? }.
//
// Сначала детерминированный разбор простых «задачу N … HH:MM», затем Gemini.
// Проверку «время в прошлом» делает только сервер (не LLM).
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION, ACTIONS } = require("./config");
const { tryExtractReschedule } = require("./extract");
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

function finalizeReschedule(action, taskNumber, dueDateMskLocal) {
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

  const fast = tryExtractReschedule(text);
  if (fast) {
    console.log(
      `[tasks/manage/parser] fast-path reschedule #${fast.taskNumber} → ${fast.dueDateMskLocal}`,
    );
    return finalizeReschedule("reschedule", fast.taskNumber, fast.dueDateMskLocal);
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
    console.log(`[tasks/manage/parser] JSON не разобран: ${raw.slice(0, 200)}`);
    return { status: "error", error: "parse_failed" };
  }

  console.log(
    `[tasks/manage/parser] Gemini → status=${parsed.status} action=${parsed.action} ` +
      `num=${parsed.task_number ?? "null"} due=${parsed.due_date_msk || "null"}`,
  );

  const action = String(parsed.action || "").trim();
  if (!ACTIONS.includes(action)) {
    return { status: "error", error: "unknown_action" };
  }

  const taskNumber = normalizeTaskNumber(parsed.task_number);
  const dueDateMskLocal = parsed.due_date_msk ? String(parsed.due_date_msk).trim() : null;

  // Если модель вернула due_date_msk — проверяем на сервере (игнорируем ложный rejected).
  if (action === "reschedule" && dueDateMskLocal) {
    const finalized = finalizeReschedule(action, taskNumber, dueDateMskLocal);
    if (finalized.status === "ok") return finalized;
    if (parsed.status !== "rejected") return finalized;
  }

  if (parsed.status === "rejected") {
    const reason =
      String(parsed.reason || "").trim() || "Не удалось однозначно разобрать команду.";
    return { status: "rejected", action, taskNumber, reason };
  }

  if (action !== "reschedule") {
    return { status: "ok", action, taskNumber, dueDateUtc: null, dueDateMskLocal: null };
  }

  return finalizeReschedule(action, taskNumber, dueDateMskLocal);
}

module.exports = { parseManageMessage };
