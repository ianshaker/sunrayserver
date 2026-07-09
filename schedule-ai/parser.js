// ============================================================================
// Извлечение параметров запроса расписания через Gemini (этап 1 отдела).
// Модель отдаёт только «что спросили», без данных из БД — см. prompts.js.
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION, MAX_DATE_RANGE_DAYS } = require("./config");
const { buildExtractPrompt, buildExtractUserPrompt } = require("./prompts");
const { nowMskString, mskLocalToDate } = require("../tasks/create/time");
const { buildMasterRosterText } = require("./masterAliases");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
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
  return { status: "clarify", question: question || "Уточните запрос." };
}

function unsupported(message) {
  return {
    status: "unsupported",
    message: message || "Такой запрос пока не поддерживается — уточните мастера и конкретную дату.",
  };
}

function isDateWithinRange(dateStr) {
  const date = new Date(`${dateStr}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return false;
  const now = Date.now();
  const diffDays = Math.abs(date.getTime() - now) / (24 * 60 * 60 * 1000);
  return diffDays <= MAX_DATE_RANGE_DAYS;
}

/**
 * @param {string} text
 * @param {{ replyText?: string|null }} opts
 * @returns {Promise<
 *   | { status: "ok", mastersRaw: string[], date: string, queryType: "full_day"|"time_point", timeFrom: string|null, timeTo: string|null }
 *   | { status: "ok", mastersRaw: string[], queryType: "nearest_city", cityRaw: string, typeFilterRaw: string|null }
 *   | { status: "clarify", question: string }
 *   | { status: "unsupported", message: string }
 *   | { status: "error", error: string }
 * >}
 */
async function parseScheduleQuery(text, { replyText } = {}) {
  if (!text || !text.trim()) {
    return clarify("Уточните, какого мастера и на какую дату показать расписание?");
  }
  if (!hasCredentials()) {
    console.log("[schedule-ai/parser] AI недоступен (нет credentials)");
    return { status: "error", error: "ai_disabled" };
  }

  const nowMsk = nowMskString();
  const systemPrompt = buildExtractPrompt(nowMsk, buildMasterRosterText());
  const userPrompt = buildExtractUserPrompt(text, replyText);

  console.log(`[schedule-ai/parser] запрос Gemini, длина=${text.trim().length}`);

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
    console.log(`[schedule-ai/parser] пустой ответ Gemini: finish=${finishReason || "?"}`);
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.log("[schedule-ai/parser] JSON не разобран");
    return { status: "error", error: "parse_failed" };
  }

  if (parsed.status === "unsupported") {
    return unsupported(String(parsed.clarification_question || "").trim());
  }

  if (parsed.status === "clarify") {
    return clarify(String(parsed.clarification_question || "").trim());
  }

  const mastersRaw = Array.isArray(parsed.masters_raw)
    ? parsed.masters_raw.map((m) => String(m || "").trim()).filter(Boolean)
    : [];

  const queryType =
    parsed.query_type === "time_point"
      ? "time_point"
      : parsed.query_type === "nearest_city"
        ? "nearest_city"
        : "full_day";

  // nearest_city: мастер не обязателен (пустой список = "любой мастер"),
  // дата не спрашивается у модели — поиск идёт от сегодня вперёд по коду.
  if (queryType === "nearest_city") {
    const cityRaw = parsed.city_raw ? String(parsed.city_raw).trim() : "";
    if (!cityRaw) {
      return clarify("Не понял, какой город искать — уточните название.");
    }
    const typeFilterRaw = parsed.type_filter ? String(parsed.type_filter).trim() : null;
    return {
      status: "ok",
      mastersRaw,
      queryType,
      cityRaw,
      typeFilterRaw,
    };
  }

  if (!mastersRaw.length) {
    return clarify("Не понял, о каком мастере речь — уточните имя.");
  }

  const date = parsed.date ? String(parsed.date).trim() : null;
  if (!date || !DATE_RE.test(date) || !mskLocalToDate(`${date}T00:00:00`)) {
    return clarify("Не понял, на какую дату показать расписание — уточните день.");
  }
  if (!isDateWithinRange(date)) {
    return clarify("Дата выглядит нереалистично далёкой — уточните, на какой день нужно расписание.");
  }

  let timeFrom = null;
  let timeTo = null;
  if (queryType === "time_point") {
    timeFrom = parsed.time_from ? String(parsed.time_from).trim() : null;
    timeTo = parsed.time_to ? String(parsed.time_to).trim() : timeFrom;
    if (!timeFrom || !TIME_RE.test(timeFrom) || !TIME_RE.test(timeTo)) {
      return clarify("Не понял, про какое время дня спросили — уточните час.");
    }
  }

  return {
    status: "ok",
    mastersRaw,
    date,
    queryType,
    timeFrom,
    timeTo,
  };
}

module.exports = { parseScheduleQuery };
