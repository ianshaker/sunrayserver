// ============================================================================
// Ветка B: поиск задачи по контексту (без номера).
// Один вызов Gemini: текст сотрудника + список активных задач → found/ambiguous/not_found.
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION } = require("./config");
const { buildContextSearchPrompt, buildContextSearchUserPrompt } = require("./contextPrompts");
const { fetchActiveTasksForContext, fetchTaskByNumberAny } = require("../taskActions");

function parseJson(raw) {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

/**
 * Ищет задачу по смыслу текста (без номера).
 *
 * @returns {Promise<
 *   | { status: "found", task: object }
 *   | { status: "ambiguous", candidates: {task_number: number, title: string}[] }
 *   | { status: "not_found" }
 *   | { status: "no_tasks" }
 *   | { status: "error", error: string }
 * >}
 */
async function findTaskByContext(text, action) {
  if (!hasCredentials()) {
    return { status: "error", error: "ai_disabled" };
  }

  let tasks;
  try {
    tasks = await fetchActiveTasksForContext();
  } catch (error) {
    console.error("[tasks/manage/context] выборка активных задач:", error.message);
    return { status: "error", error: "db_error" };
  }

  if (!tasks.length) {
    return { status: "no_tasks" };
  }

  console.log(
    `[tasks/manage/context] поиск по контексту: action=${action}, задач=${tasks.length}, текст="${text.slice(0, 60)}"`,
  );

  const systemPrompt = buildContextSearchPrompt(action);
  const userPrompt = buildContextSearchUserPrompt(text, tasks);

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
    console.log(`[tasks/manage/context] пустой ответ: finish=${finishReason}`);
    return { status: "error", error: "empty_response" };
  }

  const result = parseJson(raw);
  if (!result) {
    console.log(`[tasks/manage/context] JSON не разобран: ${raw.slice(0, 200)}`);
    return { status: "error", error: "parse_failed" };
  }

  console.log(
    `[tasks/manage/context] Gemini → status=${result.status}` +
      (result.task_number ? ` num=${result.task_number}` : "") +
      (result.candidates ? ` candidates=${result.candidates.length}` : ""),
  );

  if (result.status === "found") {
    if (!result.task_number) return { status: "not_found" };
    let task;
    try {
      task = await fetchTaskByNumberAny(result.task_number);
    } catch (error) {
      console.error("[tasks/manage/context] выборка задачи:", error.message);
      return { status: "error", error: "db_error" };
    }
    if (!task) return { status: "not_found" };
    return { status: "found", task };
  }

  if (result.status === "ambiguous") {
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    return { status: "ambiguous", candidates: candidates.slice(0, 5) };
  }

  return { status: "not_found" };
}

module.exports = { findTaskByContext };
