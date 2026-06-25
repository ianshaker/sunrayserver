// ============================================================================
// Q&A по истории звонков клиента (Gemini + сводки из mango_calls).
// ============================================================================

const { supabase } = require("../supabaseClient");
const { hasCredentials } = require("../googleAuth");
const { generateContent } = require("../geminiClient");
const { SUMMARY } = require("../config");
const { MAX_CALLS } = require("./config");
const { CALL_ASK_SYSTEM_PROMPT } = require("./prompts");

const { VERTEX_LOCATION, MODEL: GEMINI_MODEL } = SUMMARY;

function formatCallDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildCallsContext(calls) {
  return calls
    .map((c, i) => {
      const when = formatCallDateTime(c.call_started_at);
      const dir = c.direction === 2 ? "Исходящий" : "Входящий";
      return (
        `[Звонок ${i + 1}]\n` +
        `entry_id: ${c.entry_id}\n` +
        `Дата: ${when}\n` +
        `${dir}, менеджер: ${c.manager_name || "—"}\n` +
        `Сводка:\n${(c.summary || "").trim()}`
      );
    })
    .join("\n\n---\n\n");
}

function buildUserPrompt(question, calls) {
  return (
    `Вопрос менеджера:\n${question.trim()}\n\n` +
    `Сводки звонков клиента (${calls.length} шт., новые сверху):\n\n` +
    buildCallsContext(calls)
  );
}

function parseAskResponse(raw) {
  const fallback = {
    found: false,
    answer: raw || "Не удалось разобрать ответ модели.",
    quotes: [],
    search_hint: null,
  };
  if (!raw) return fallback;

  let jsonStr = raw.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      found: Boolean(parsed.found),
      answer: String(parsed.answer || "").trim() || fallback.answer,
      quotes: Array.isArray(parsed.quotes)
        ? parsed.quotes
            .filter((q) => q && (q.text || q.entry_id))
            .map((q) => ({
              entry_id: q.entry_id ? String(q.entry_id) : null,
              call_date: q.call_date ? String(q.call_date) : null,
              text: q.text ? String(q.text).trim() : "",
            }))
        : [],
      search_hint: parsed.search_hint ? String(parsed.search_hint).trim() : null,
    };
  } catch (_) {
    return { ...fallback, answer: raw.trim() };
  }
}

async function fetchCallsWithSummaries(phone, limit = MAX_CALLS) {
  const { data, error } = await supabase.rpc("get_mango_calls_by_phone", {
    search_phone: phone,
  });
  if (error) throw new Error("Supabase: " + error.message);

  return (data || [])
    .filter((row) => row.summary_status === "done" && row.summary && row.summary.trim())
    .slice(0, limit);
}

async function askAboutCalls({ phone, question, limit = MAX_CALLS }) {
  if (!phone || !String(phone).trim()) {
    return { status: "error", error: "phone_required" };
  }
  if (!question || !String(question).trim()) {
    return { status: "error", error: "question_required" };
  }
  if (!hasCredentials()) {
    return { status: "error", error: "ai_disabled" };
  }

  const calls = await fetchCallsWithSummaries(phone, limit);
  if (!calls.length) {
    return {
      status: "ok",
      phone: String(phone).trim(),
      calls_used: 0,
      found: false,
      answer: "У этого клиента пока нет готовых AI-сводок звонков.",
      quotes: [],
      search_hint: null,
    };
  }

  const userPrompt = buildUserPrompt(question, calls);
  const { text, finishReason } = await generateContent({
    systemPrompt: CALL_ASK_SYSTEM_PROMPT,
    userPrompt,
    model: GEMINI_MODEL,
    location: VERTEX_LOCATION,
    generationConfig: { responseMimeType: "application/json" },
  });

  if (!text) {
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseAskResponse(text);
  console.log(
    `💬 Call ask: phone=${String(phone).slice(-4)}, calls=${calls.length}, found=${parsed.found}`
  );

  return {
    status: "ok",
    phone: String(phone).trim(),
    calls_used: calls.length,
    model: GEMINI_MODEL,
    ...parsed,
  };
}

module.exports = { askAboutCalls, fetchCallsWithSummaries };
