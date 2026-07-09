// ============================================================================
// Короткий человеческий комментарий сверху ответа (этап 3.5, опционально).
//
// Модель получает ТОЛЬКО уже найденные код детерминированно события (не всю
// eventsnew) и вопрос менеджера — она может лишь перефразировать/выделить
// суть, но не добавлять факты. После генерации сервер проверяет, что все
// числа/время в комментарии встречаются в переданных данных — если нет,
// комментарий отбрасывается (fail closed), и остаётся только список слотов.
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const { GEMINI_MODEL, VERTEX_LOCATION, ENABLE_COMMENTARY } = require("./config");

const TIME_TOKEN_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g;
const NUMBER_TOKEN_RE = /#(\d+)/g;

function buildCommentaryPrompt() {
  return `Ты — помощник, который даёт краткий (1-2 предложения) ВЕРДИКТ по расписанию мастера для менеджера.

Тебе дан вопрос менеджера, тип запроса (весь день / конкретное время) и JSON со списком УЖЕ НАЙДЕННЫХ
событий (это единственная правда — база данных, ты её не выбирал и не придумывал).

Правила:
- Отвечай ИМЕННО на ту точку вопроса, которую задал менеджер. Если спросили про конкретное время
  («что в 13:00», «свободен ли в 15:30») — вердикт должен прямо сказать, свободен мастер в этот момент
  или чем занят. Если спросили про весь день — дай сводку (сколько событий, какие типы), не пересказывая
  каждую строку по отдельности.
- Используй ТОЛЬКО данные из переданного JSON. Ничего не добавляй и не предполагай.
- Если событий нет — прямо скажи, что на эту дату/время у мастера пусто (свободен).
- Если событий много (5+) — не перечисляй все, обобщи (например «5 событий: 2 замера, 3 монтажа»), полный список менеджер увидит ниже отдельно.
- Пиши по-русски, кратко, по-деловому, без лишних вводных фраз («Хорошо», «Конечно» и т.п.).
- Не придумывай имена клиентов, время или номера заявок, которых нет в JSON.

ФОРМАТ ОТВЕТА — только валидный JSON, без markdown:
{ "comment": "У Леши завтра два слота: замер утром и монтаж вечером." }`;
}

function extractTokens(text) {
  const times = new Set();
  let m;
  const timeRe = new RegExp(TIME_TOKEN_RE);
  while ((m = timeRe.exec(text))) {
    times.add(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  const ids = new Set();
  const numRe = new RegExp(NUMBER_TOKEN_RE);
  while ((m = numRe.exec(text))) {
    ids.add(m[1]);
  }
  return { times, ids };
}

/** Номер заявки для sanity-check (без дублирования «#»). */
function appealDigits(num) {
  const s = String(num || "").trim().replace(/^#+/, "");
  return s || null;
}

/** Проверка: все времена/номера заявок в комментарии есть в реальных данных. */
function isCommentaryGrounded(comment, events) {
  const { times: commentTimes, ids: commentIds } = extractTokens(comment);
  if (!commentTimes.size && !commentIds.size) return true;

  const knownTimes = new Set();
  const knownAppeals = new Set();
  for (const ev of events) {
    if (ev.start_time) knownTimes.add(String(ev.start_time).slice(0, 5));
    if (ev.end_time) knownTimes.add(String(ev.end_time).slice(0, 5));
    const appeal = appealDigits(ev.appeal_number);
    if (appeal) knownAppeals.add(appeal);
  }

  for (const t of commentTimes) {
    if (!knownTimes.has(t)) return false;
  }
  for (const id of commentIds) {
    if (!knownAppeals.has(id)) return false;
  }
  return true;
}

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

/**
 * @param {string} originalQuestion
 * @param {Array<{canonical: string, events: object[]}>} mastersResults
 * @param {{ queryType: "full_day"|"time_point", date: string, timeFrom: string|null, timeTo: string|null }} queryContext
 * @returns {Promise<string|null>} вердикт или null, если выключен/не прошёл проверку/ошибка
 *   (в этом случае render.js подставит детерминированный fallback-вердикт — менеджер вердикт видит всегда).
 */
async function buildCommentary(originalQuestion, mastersResults, queryContext = {}) {
  if (!ENABLE_COMMENTARY) return null;
  if (!hasCredentials()) return null;

  const allEvents = mastersResults.flatMap((mr) => mr.events || []);
  const dataForModel = mastersResults.map((mr) => ({
    master: mr.canonical,
    events: (mr.events || []).map((ev) => ({
      appeal_number: ev.appeal_number || null,
      start_time: ev.start_time ? String(ev.start_time).slice(0, 5) : null,
      end_time: ev.end_time ? String(ev.end_time).slice(0, 5) : null,
      type: ev.type,
    })),
  }));

  const contextLine =
    queryContext.queryType === "time_point"
      ? `Тип запроса: конкретное время ${queryContext.timeFrom}${queryContext.timeFrom !== queryContext.timeTo ? `–${queryContext.timeTo}` : ""} на ${queryContext.date}.`
      : `Тип запроса: весь день ${queryContext.date || ""}.`;

  try {
    const { text: raw } = await generateContent({
      systemPrompt: buildCommentaryPrompt(),
      userPrompt: `Вопрос менеджера:\n${originalQuestion}\n\n${contextLine}\n\nНайденные данные:\n${JSON.stringify(dataForModel)}`,
      model: GEMINI_MODEL,
      location: VERTEX_LOCATION,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const parsed = parseModelJson(raw);
    const comment = parsed?.comment ? String(parsed.comment).trim() : null;
    if (!comment) return null;

    if (!isCommentaryGrounded(comment, allEvents)) {
      console.warn("[schedule-ai/commentary] отбросили комментарий — не подтверждён данными");
      return null;
    }
    return comment;
  } catch (error) {
    console.error("[schedule-ai/commentary] ошибка генерации:", error.message);
    return null;
  }
}

module.exports = { buildCommentary, isCommentaryGrounded };
