// ============================================================================
// Парсер команд управления задачами (этап 2):
// текст → { action, taskNumber, dueDateUtc?, extraAssigneeId?, descriptionAppend? }.
//
// Единственная точка понимания команды — Gemini.
// Проверку «время в прошлом» и валидацию полей делает сервер после ответа модели.
// ============================================================================

const { hasCredentials } = require("../../call-ai/googleAuth");
const { generateContent } = require("../../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION, ACTIONS } = require("./config");
const { buildManagePrompt, buildManageUserPrompt } = require("./prompts");
const { nowMskString, mskLocalToUtcIso } = require("../create/time");
const { buildRosterText, validateAssigneeId } = require("../create/assigneeRoster");

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

function normalizeDescriptionAppend(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

async function resolveExtraAssigneeId(rawId) {
  if (!rawId) return null;
  const id = String(rawId).trim();
  if (!id) return null;
  const valid = await validateAssigneeId(id);
  if (!valid) {
    console.log(`[tasks/manage/parser] extra_assignee_id "${id}" не найден в ростере — игнорируем`);
    return null;
  }
  return id;
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

function finalizeEdit(taskNumber, dueDateMskLocal, extraAssigneeId, descriptionAppend) {
  const hasDue = !!dueDateMskLocal;
  const hasAssignee = !!extraAssigneeId;
  const hasDesc = !!descriptionAppend;

  if (!hasDue && !hasAssignee && !hasDesc) {
    return {
      status: "rejected",
      action: "edit",
      taskNumber,
      reason: "Не указано, что изменить в задаче.",
    };
  }

  let dueDateUtc = null;
  let dueDateMskLocalOut = null;

  if (hasDue) {
    const finalized = finalizeReschedule("edit", taskNumber, dueDateMskLocal);
    if (finalized.status !== "ok") return finalized;
    dueDateUtc = finalized.dueDateUtc;
    dueDateMskLocalOut = finalized.dueDateMskLocal;
  }

  return {
    status: "ok",
    action: "edit",
    taskNumber,
    dueDateUtc,
    dueDateMskLocal: dueDateMskLocalOut,
    extraAssigneeId,
    descriptionAppend,
  };
}

function okPayload(action, taskNumber, dueDateUtc, dueDateMskLocal, extraAssigneeId, descriptionAppend) {
  return {
    status: "ok",
    action,
    taskNumber,
    dueDateUtc: dueDateUtc || null,
    dueDateMskLocal: dueDateMskLocal || null,
    extraAssigneeId: extraAssigneeId || null,
    descriptionAppend: descriptionAppend || null,
  };
}

/**
 * @returns {Promise<
 *   | { status: "ok", action, taskNumber, dueDateUtc, dueDateMskLocal, extraAssigneeId, descriptionAppend }
 *   | { status: "rejected", action, taskNumber, reason }
 *   | { status: "error", error }
 * >}
 */
async function parseManageMessage(text, { replyText } = {}) {
  if (!text || !text.trim()) {
    return { status: "error", error: "empty_input" };
  }

  if (!hasCredentials()) {
    console.log("[tasks/manage/parser] AI недоступен (нет credentials)");
    return { status: "error", error: "ai_disabled" };
  }

  console.log(
    `[tasks/manage/parser] запрос Gemini, длина=${text.trim().length}` +
      (replyText ? ` +reply=${replyText.trim().length}` : ""),
  );

  const rosterText = await buildRosterText();
  const systemPrompt = buildManagePrompt(nowMskString(), rosterText);
  const userPrompt = buildManageUserPrompt(text, replyText);

  const { text: raw, finishReason } = await generateContent({
    systemPrompt,
    userPrompt,
    model: GEMINI_MODEL,
    location: VERTEX_LOCATION,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 768,
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
      `num=${parsed.task_number ?? "null"} due=${parsed.due_date_msk || "null"} ` +
      `assignee=${parsed.extra_assignee_id || "null"} desc=${parsed.description_append ? "yes" : "null"}`,
  );

  const action = String(parsed.action || "").trim();
  if (!ACTIONS.includes(action)) {
    return { status: "error", error: "unknown_action" };
  }

  const taskNumber = normalizeTaskNumber(parsed.task_number);
  const dueDateMskLocal = parsed.due_date_msk ? String(parsed.due_date_msk).trim() : null;
  const extraAssigneeId = await resolveExtraAssigneeId(parsed.extra_assignee_id);
  const descriptionAppend = normalizeDescriptionAppend(parsed.description_append);

  if (action === "edit") {
    if (parsed.status === "rejected") {
      const reason =
        String(parsed.reason || "").trim() || "Не указано, что изменить в задаче.";
      return { status: "rejected", action, taskNumber, reason };
    }
    return finalizeEdit(taskNumber, dueDateMskLocal, extraAssigneeId, descriptionAppend);
  }

  // reschedule с due_date — проверяем на сервере
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

  if (action === "reschedule") {
    return finalizeReschedule(action, taskNumber, dueDateMskLocal);
  }

  return okPayload(action, taskNumber, null, null, null, null);
}

module.exports = { parseManageMessage };
