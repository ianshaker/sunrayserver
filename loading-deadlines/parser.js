// ============================================================================
// Парсер команд для модуля дедлайнов погрузки.
//
// Реализованы: reschedule | info_added | reject | assign_zamer | return_appeals.
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const { SUMMARY } = require("../call-ai/config");
const { getMskTodayDate } = require("./queries");
const {
  normalizeInfoUpdates,
  hasAnyInfoUpdate,
} = require("../appeals-deadlines/infoUpdates");
const { normalizeStartTime, addOneHour } = require("./masters");

const GEMINI_MODEL = SUMMARY.MODEL;
const VERTEX_LOCATION = SUMMARY.VERTEX_LOCATION;

const ACTIONS = ["reschedule", "info_added", "reject", "assign_zamer", "return_appeals"];
const IMPLEMENTED = new Set([
  "reschedule",
  "info_added",
  "reject",
  "assign_zamer",
  "return_appeals",
]);
const GEMINI_TIMEOUT_MS = parseInt(process.env.DEADLINE_PARSER_GEMINI_TIMEOUT_MS || "45000", 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extractAppealNumberFromReply(replyText) {
  if (!replyText) return null;
  const m =
    replyText.match(/ДЕДЛАЙН\s+ПОГРУЗКИ\s*#?(\d{5})/i) ||
    replyText.match(/#(\d{5})\b/);
  return m ? `#${m[1]}` : null;
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

function getNeedsDeadlineResolutionReason(appealNumber) {
  const num = appealNumber || "заявке";
  return (
    `Не могу закрыть дедлайн погрузки по ${num} без решения. ` +
    `Укажите перенос дедлайна, добавьте инфо с новой датой, поставьте отказ, ` +
    `верните во входящие или назначьте замер (мастер + дата + время).`
  );
}

function buildSystemPrompt() {
  const today = getMskTodayDate();
  const year = today.slice(0, 4);
  return `Ты — парсер команд менеджера по ДЕДЛАЙНАМ ПОГРУЗКИ компании SUNRAY.

КОНТЕКСТ: менеджер пишет в чате отдела «Погрузка / НА ЗАМЕР» или отвечает на карточку «ДЕДЛАЙН ПОГРУЗКИ #…».
Это НЕ входящие обращения и НЕ manager-задачи — только события eventsnew со статусом «Погрузка».

Заявка считается «решённой» если:
• reschedule — перенос дедлайна на новую дату
• info_added — обновить поля И обязательно new_date
• reject — отказ
• assign_zamer — назначить замер мастеру на дату и время
• return_appeals — вернуть во входящие обращения

Сегодня (Москва): ${today}. Год для дат — ${year}, если не указан.
«Сегодня» → ${today}. «Завтра» → следующий день. «Послезавтра» → через два дня.

ДАТА ДЕДЛАЙНА (reschedule / info_added):
• «перенести на 10 июля», «на завтра» → new_date
• «оставить дедлайн на 1 июля» → тоже new_date
• «1 июля» без года → ${year}-07-01

ИНФО ПО ЗАЯВКЕ (action=info_added):
• телефон / доп. тел / город / detailed_address / dialog_text / client_name

action — одно из:
- reschedule: только перенести дедлайн
- info_added: добавить инфо И перенести дедлайн (обязательно new_date)
- reject: отказ («в отказ», «отказали») — new_date не нужен; reject_reason если указали
- assign_zamer: назначить замер («назначь на Антона завтра в 14», «замер Роме на 10 июля в 11:00»)
- return_appeals: вернуть во входящие («верни во входящие», «вернуть в обращения», «назад во входящие») — new_date не нужен

Для assign_zamer ОБЯЗАТЕЛЬНО извлеки:
- master_raw — как менеджер назвал мастера (Антон, Роме, Тимуру, Семёну…)
- date — YYYY-MM-DD дата ВЫЕЗДА замера (не путать с new_date переноса дедлайна)
- start_time — время начала HH:mm («14», «14:00», «2 часа дня» → 14:00; «11 утра» → 11:00)
Конец слота код поставит сам (+1 час). end_time НЕ нужен.

ОБЯЗАТЕЛЬНО status=rejected если:
- просят только инфо БЕЗ new_date, без reject, без assign_zamer
- action reschedule или info_added без new_date
- action assign_zamer без мастера или без даты или без времени
- просят изменить основной адрес Google Maps

ФОРМАТ ОТВЕТА — только JSON.

Пример назначения:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "assign_zamer",
  "master_raw": "Антон",
  "date": "${today}",
  "start_time": "14:00"
}

Пример переноса:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "info_added",
  "new_date": "2026-07-15",
  "info_updates": { "extra_phone": "8(903)111-22-33" }
}

Пример отказа:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "reject",
  "reject_reason": "клиент передумал"
}

Пример возврата во входящие:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "return_appeals"
}`;
}

/**
 * @param {string} text
 * @param {{ replyText?: string }} options
 */
async function parseDeadlineCommand(text, { replyText } = {}) {
  if (!text?.trim()) {
    return { status: "error", error: "empty_input" };
  }

  if (!hasCredentials()) {
    return { status: "error", error: "ai_disabled" };
  }

  const userParts = [`Команда менеджера:\n${text.trim()}`];
  if (replyText) {
    userParts.push(
      `\nКонтекст (сообщение, на которое менеджер сделал отсечку):\n${replyText.slice(0, 400)}`,
    );
  }

  const startedAt = Date.now();
  console.log(`[loading-deadlines/parser] → Gemini (timeout ${GEMINI_TIMEOUT_MS}ms)`);

  let raw;
  let finishReason;
  try {
    const geminiPromise = generateContent({
      systemPrompt: buildSystemPrompt(),
      userPrompt: userParts.join("\n"),
      model: GEMINI_MODEL,
      location: VERTEX_LOCATION,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("gemini_timeout")), GEMINI_TIMEOUT_MS);
    });
    ({ text: raw, finishReason } = await Promise.race([geminiPromise, timeoutPromise]));
  } catch (err) {
    console.error(
      `[loading-deadlines/parser] Gemini ошибка ${Date.now() - startedAt}ms:`,
      err.message,
    );
    return {
      status: "error",
      error: err.message === "gemini_timeout" ? "gemini_timeout" : "gemini_failed",
    };
  }

  console.log(
    `[loading-deadlines/parser] Gemini ← ${Date.now() - startedAt}ms finish=${finishReason || "?"} len=${raw?.length || 0}`,
  );

  if (!raw) {
    return {
      status: "error",
      error: finishReason === "MAX_TOKENS" ? "response_truncated" : "empty_response",
    };
  }

  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.warn(`[loading-deadlines/parser] JSON parse failed: ${raw.slice(0, 200)}`);
    return { status: "error", error: "parse_failed" };
  }

  if (parsed.status === "rejected") {
    const reason = String(parsed.reason || "Не удалось разобрать команду.");
    console.log(`[loading-deadlines/parser] rejected: ${reason.slice(0, 160)}`);
    return { status: "rejected", reason };
  }

  let appealNumber = String(parsed.appeal_number || "").trim() || null;
  if (!appealNumber && replyText) {
    appealNumber = extractAppealNumberFromReply(replyText);
    if (appealNumber) {
      console.log(`[loading-deadlines/parser] appeal_number из reply: ${appealNumber}`);
    }
  }
  const action = String(parsed.action || "").trim();

  if (!appealNumber) {
    return { status: "rejected", reason: "Не удалось определить номер заявки." };
  }

  if (!ACTIONS.includes(action)) {
    return { status: "rejected", reason: "Не удалось определить действие по заявке." };
  }

  if (!IMPLEMENTED.has(action)) {
    return {
      status: "stub",
      appealNumber,
      action,
    };
  }

  const result = { status: "ok", appealNumber, action };

  if (parsed.new_date) {
    result.newDate = String(parsed.new_date).trim();
  }

  const infoUpdates = normalizeInfoUpdates(parsed);
  if (hasAnyInfoUpdate(infoUpdates)) {
    result.infoUpdates = infoUpdates;
  }

  if (parsed.reject_reason) {
    const reason = String(parsed.reject_reason).trim();
    if (reason) result.rejectReason = reason;
  }

  if (action === "assign_zamer") {
    const masterRaw = String(parsed.master_raw || parsed.master || "").trim();
    const date = String(parsed.date || "").trim();
    const startRaw = String(parsed.start_time || parsed.time || "").trim();

    if (!masterRaw) {
      return {
        status: "rejected",
        reason: "Укажите мастера для назначения замера (например «на Антона»).",
      };
    }
    if (!DATE_RE.test(date)) {
      return {
        status: "rejected",
        reason: "Укажите дату выезда замера (например «завтра» или «10 июля»).",
      };
    }
    const startTime = normalizeStartTime(startRaw);
    if (!startTime) {
      return {
        status: "rejected",
        reason: "Укажите время начала замера (например «14:00» или «в 14»).",
      };
    }
    const endTime = addOneHour(startTime);
    if (!endTime) {
      return {
        status: "rejected",
        reason: "Слот на 1 час уходит за полночь — выберите более раннее время.",
      };
    }

    result.masterRaw = masterRaw;
    result.date = date;
    result.startTime = startTime;
    result.endTime = endTime;
  }

  if ((action === "reschedule" || action === "info_added") && !result.newDate) {
    console.log(`[loading-deadlines/parser] отказ: ${appealNumber} ${action} без new_date`);
    return {
      status: "rejected",
      reason: getNeedsDeadlineResolutionReason(appealNumber),
    };
  }

  console.log(
    `[loading-deadlines/parser] Gemini → ${appealNumber} ${action}` +
      (result.newDate ? ` → ${result.newDate}` : "") +
      (result.date ? ` date=${result.date}` : "") +
      (result.startTime ? ` ${result.startTime}-${result.endTime}` : "") +
      (result.masterRaw ? ` master=${result.masterRaw}` : "") +
      (result.infoUpdates ? " +info" : "") +
      (result.rejectReason ? " +reason" : ""),
  );

  return result;
}

function formatDateHuman(isoDate) {
  if (!isoDate) return isoDate;
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const [, m, d] = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  if (!m || !d) return isoDate;
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]}`;
}

module.exports = { parseDeadlineCommand, formatDateHuman };
