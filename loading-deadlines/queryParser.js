// ============================================================================
// Извлечение параметров запроса дедлайнов по погрузке через Gemini.
// Модель отдаёт только «что спросили» — список событий читает код.
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const { SUMMARY } = require("../call-ai/config");
const { getMskTodayDate } = require("./queries");
const { QUERY_LIST_CAP } = require("./config");
const { buildExtractPrompt, buildExtractUserPrompt } = require("./queryPrompts");

const GEMINI_MODEL = SUMMARY.MODEL;
const VERTEX_LOCATION = SUMMARY.VERTEX_LOCATION;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function clarify(question) {
  return {
    status: "clarify",
    question: question || "Уточните: дедлайны по погрузке или по задачам?",
  };
}

function unsupported(message) {
  return {
    status: "unsupported",
    message:
      message ||
      "Этот запрос не про просмотр дедлайнов погрузки. Для действий ответьте на карточку «ДЕДЛАЙН ПОГРУЗКИ» — пока бот ответит заглушкой.",
  };
}

/**
 * @param {string} text
 * @param {{ replyText?: string|null }} opts
 */
async function parseDeadlineQuery(text, { replyText } = {}) {
  if (!text || !text.trim()) {
    return clarify("Уточните: какие дедлайны по погрузке показать и на какую дату?");
  }
  if (!hasCredentials()) {
    console.log("[loading-deadlines/queryParser] AI недоступен (нет credentials)");
    return { status: "error", error: "ai_disabled" };
  }

  const today = getMskTodayDate();
  const systemPrompt = buildExtractPrompt(today);
  const userPrompt = buildExtractUserPrompt(text, replyText);

  console.log(`[loading-deadlines/queryParser] запрос Gemini, длина=${text.trim().length}`);

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
    console.log(
      `[loading-deadlines/queryParser] пустой ответ Gemini: finish=${finishReason || "?"}`,
    );
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.log("[loading-deadlines/queryParser] JSON не разобран");
    return { status: "error", error: "parse_failed" };
  }

  if (parsed.status === "unsupported") {
    return unsupported(String(parsed.clarification_question || "").trim());
  }

  if (parsed.status === "clarify") {
    return clarify(String(parsed.clarification_question || "").trim());
  }

  const mode =
    parsed.mode === "urgent"
      ? "urgent"
      : parsed.mode === "recent_past"
        ? "recent_past"
        : "by_date";
  const domainOk = parsed.domain_ok === true;
  const all = parsed.all === true;

  let date = null;
  if (mode === "by_date") {
    date = parsed.date ? String(parsed.date).trim() : today;
    if (!DATE_RE.test(date)) {
      return clarify("Не понял дату — скажите, на какой день показать дедлайны по погрузке?");
    }
  }

  let limit = 1;
  if (all) {
    limit = QUERY_LIST_CAP;
  } else if (parsed.limit != null && parsed.limit !== "") {
    const n = parseInt(parsed.limit, 10);
    if (!Number.isFinite(n) || n < 1) {
      return clarify("Не понял, сколько заявок показать — скажите число или «все».");
    }
    limit = Math.min(n, QUERY_LIST_CAP);
  }

  return {
    status: "ok",
    mode,
    date,
    limit,
    all,
    domainOk,
  };
}

module.exports = { parseDeadlineQuery };
