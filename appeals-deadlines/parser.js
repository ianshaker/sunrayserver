// ============================================================================
// Парсер команд для модуля дедлайнов входящих.
//
// Разбирает текст менеджера вида:
//   «#08044 перенести дедлайн на 10 июля»
//   «заявка 08044, отказ»
//   «погрузка по #08044»
//
// Возвращает:
//   { status: "ok", appealNumber, action, newDate? }
//   { status: "rejected", reason }
//   { status: "error", error }
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-001";
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || "us-central1";

const ACTIONS = ["reschedule", "reject", "loading", "info_added"];

/** Извлекает номер заявки из текста: #08044, 08044, «08044» и т.п. */
function extractAppealNumber(text) {
  if (!text) return null;
  const m = text.match(/#?(\d{5})/);
  return m ? `#${m[1]}` : null;
}

/** Детерминированное определение действия по ключевым словам. */
function detectActionFast(text) {
  const t = text.toLowerCase();
  if (/отказ|отказали|отк\./.test(t)) return "reject";
  if (/погруз|в\s+погруз/.test(t)) return "loading";
  if (/добав.*инфо|инфо.*перен|доп.*инфо/.test(t)) return "info_added";
  if (/перен[её]с|перенест|дедлайн.*на|на.*дедлайн|новый\s+дедлайн/.test(t)) return "reschedule";
  return null;
}

// Ключи — префиксы-регексы (используются через new RegExp(`^${prefix}`)).
// "ма[йя]" матчит и "май", и "мая".
const MONTH_MAP = {
  "январ":   "01",
  "феврал":  "02",
  "март":    "03",
  "апрел":   "04",
  "ма[йя]":  "05",
  "июн":     "06",
  "июл":     "07",
  "август":  "08",
  "сентябр": "09",
  "октябр":  "10",
  "ноябр":   "11",
  "декабр":  "12",
};

/**
 * Пытается извлечь дату (только день и месяц, год = текущий) из текста.
 * Принимает форматы: «10 июля», «10.07», «10/07».
 * @returns {string|null} YYYY-MM-DD или null
 */
function extractDateFast(text) {
  // «10 июля», «10 июн», «10-го июля»
  const ruMatch = text.match(/(\d{1,2})(?:-го)?\s+([а-яё]+)/ui);
  if (ruMatch) {
    const day = ruMatch[1].padStart(2, "0");
    const monthName = ruMatch[2].toLowerCase().slice(0, 5);
    for (const [prefix, num] of Object.entries(MONTH_MAP)) {
      const re = new RegExp(`^${prefix}`);
      if (re.test(monthName)) {
        const year = new Date().getFullYear();
        return `${year}-${num}-${day}`;
      }
    }
  }

  // «10.07» или «10/07»
  const numMatch = text.match(/(\d{1,2})[./](\d{2})/);
  if (numMatch) {
    const day = numMatch[1].padStart(2, "0");
    const month = numMatch[2];
    const year = new Date().getFullYear();
    return `${year}-${month}-${day}`;
  }

  return null;
}

function parseModelJson(raw) {
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

function buildSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `Ты — парсер команд менеджера по входящим заявкам компании SUNRAY.

Сегодня: ${today}. Год для дат — ${new Date().getFullYear()}, если не указан.

Ты получаешь текст сообщения менеджера и должен извлечь:
1. Номер заявки (appeal_number) — обычно #NNNNN или просто 5 цифр.
2. action — одно из: reschedule | reject | loading | info_added
   - reschedule: перенести дедлайн
   - reject: отказ
   - loading: в погрузку
   - info_added: добавить инфо и перенести
3. new_date — только если action=reschedule или info_added: дата в формате YYYY-MM-DD.

ФОРМАТ ОТВЕТА — только JSON:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "reschedule",
  "new_date": "2026-07-10"
}

Если не удалось разобрать:
{
  "status": "rejected",
  "reason": "Короткое объяснение на русском"
}`;
}

/**
 * Парсит команду менеджера о дедлайне.
 *
 * @param {string} text          — основной текст @упоминания
 * @param {{ replyText?: string }} options — контекст отсечки (может содержать номер заявки)
 * @returns {Promise<
 *   | { status: "ok", appealNumber: string, action: string, newDate?: string }
 *   | { status: "rejected", reason: string }
 *   | { status: "error", error: string }
 * >}
 */
async function parseDeadlineCommand(text, { replyText } = {}) {
  if (!text?.trim()) {
    return { status: "error", error: "empty_input" };
  }

  // Быстрый путь: номер — сначала в тексте, потом в отсечке (карточка бота содержит ДЕДЛАЙН #NNNNN)
  const appealNumberFast = extractAppealNumber(text) || extractAppealNumber(replyText);
  const actionFast = detectActionFast(text);

  if (appealNumberFast && actionFast) {
    const result = {
      status: "ok",
      appealNumber: appealNumberFast,
      action: actionFast,
    };

    if (actionFast === "reschedule" || actionFast === "info_added") {
      const dateFast = extractDateFast(text);
      if (dateFast) {
        result.newDate = dateFast;
        console.log(`[appeals-deadlines/parser] fast-path: ${appealNumberFast} ${actionFast} → ${dateFast}`);
        return result;
      }
      // Дата не найдена быстро — идём в Gemini
    } else {
      console.log(`[appeals-deadlines/parser] fast-path: ${appealNumberFast} ${actionFast}`);
      return result;
    }
  }

  // Fallback: Gemini
  if (!hasCredentials()) {
    return { status: "error", error: "ai_disabled" };
  }

  console.log(`[appeals-deadlines/parser] запрос Gemini для разбора команды`);

  const userParts = [`Команда менеджера:\n${text.trim()}`];
  if (replyText) {
    userParts.push(`\nКонтекст (сообщение, на которое менеджер сделал отсечку):\n${replyText.slice(0, 400)}`);
  }

  const { text: raw, finishReason } = await generateContent({
    systemPrompt: buildSystemPrompt(),
    userPrompt: userParts.join("\n"),
    model: GEMINI_MODEL,
    location: VERTEX_LOCATION,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
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

  if (parsed.status === "rejected") {
    return { status: "rejected", reason: String(parsed.reason || "Не удалось разобрать команду.") };
  }

  const appealNumber = String(parsed.appeal_number || "").trim() || null;
  const action = String(parsed.action || "").trim();

  if (!appealNumber) {
    return { status: "rejected", reason: "Не удалось определить номер заявки." };
  }

  if (!ACTIONS.includes(action)) {
    return { status: "rejected", reason: "Не удалось определить действие по заявке." };
  }

  const result = { status: "ok", appealNumber, action };

  if (parsed.new_date) {
    result.newDate = String(parsed.new_date).trim();
  }

  console.log(
    `[appeals-deadlines/parser] Gemini → ${appealNumber} ${action}` +
      (result.newDate ? ` → ${result.newDate}` : ""),
  );

  return result;
}

/**
 * Форматирует дату YYYY-MM-DD в читаемый вид «10 июля».
 */
function formatDateHuman(isoDate) {
  if (!isoDate) return isoDate;
  const months = [
    "января","февраля","марта","апреля","мая","июня",
    "июля","августа","сентября","октября","ноября","декабря",
  ];
  const [, m, d] = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  if (!m || !d) return isoDate;
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
}

module.exports = { parseDeadlineCommand, formatDateHuman };
