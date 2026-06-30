// ============================================================================
// Парсер команд для модуля дедлайнов входящих.
//
// Единственная точка понимания команды — Gemini.
// Никакого regex-парсинга действий/дат/причин — это зона нейронки.
// Структурная нормализация (форматы полей) — после Gemini, в normalizeInfoUpdates.
// ============================================================================

const { hasCredentials } = require("../call-ai/googleAuth");
const { generateContent } = require("../call-ai/geminiClient");
const { SUMMARY } = require("../call-ai/config");
const { getMskTodayDate } = require("./queries");
const { normalizeInfoUpdates, hasAnyInfoUpdate } = require("./infoUpdates");

const GEMINI_MODEL = SUMMARY.MODEL;
const VERTEX_LOCATION = SUMMARY.VERTEX_LOCATION;

const ACTIONS = ["reschedule", "reject", "loading", "info_added"];

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
  const today = getMskTodayDate();
  const year = today.slice(0, 4);
  return `Ты — парсер команд менеджера по входящим заявкам компании SUNRAY.

Сегодня (Москва): ${today}. Год для дат — ${year}, если не указан.
«Сегодня» → ${today}. «Завтра» → следующий день. «Послезавтра» → через два дня.

Ты получаешь текст сообщения менеджера и должен извлечь:
1. Номер заявки (appeal_number) — обычно #NNNNN или просто 5 цифр. Может быть только в контексте отсечки.
2. action — одно из: reschedule | reject | loading | info_added
   - reschedule: перенести дедлайн
   - reject: отказ (любые формулировки: «в отказ», «отказали», «кинь в отказ», «заапдейть как отказ» и т.п.)
   - loading: отправить в погрузку (= «на замер», «в замеры», «кинь на замер» — тот же флоу)
   - info_added: добавить/обновить/заапдейтить инфо по заявке + перенести дедлайн (БЕЗ погрузки)
3. new_date — только если action=reschedule или info_added (не для loading/reject). Формат YYYY-MM-DD.
4. reject_reason — только если action=reject: причина в свободной форме (если менеджер указал).
5. info_updates — если action=loading или info_added. Объект с любыми непустыми полями:
   - client_name — имя клиента
   - phone — основной телефон, формат 8(903)111-22-33
   - extra_phone — дополнительный телефон (дописывается через «, »)
   - city — город
   - detailed_address — детальный/уточняющий адрес (НЕ основной адрес Google Maps!)
   - dialog_text — любой свободный текст для диалога (комментарии, заметки, что сказал клиент)
   Если менеджер говорит «адрес» без уточнения — клади в detailed_address.
   Основной адрес Google Maps (поле address) МЕНЯТЬ НЕЛЬЗЯ — если просят его, верни status=rejected.

ФОРМАТ ОТВЕТА — только JSON:
{
  "status": "ok",
  "appeal_number": "#08044",
  "action": "info_added",
  "new_date": "2026-07-10",
  "info_updates": {
    "client_name": "Иван",
    "extra_phone": "8(903)111-22-33",
    "detailed_address": "ул. Ленина 5, подъезд 2",
    "dialog_text": "Клиент просит перезвонить после 18:00"
  }
}

Если просят изменить основной адрес (Google Maps):
{
  "status": "rejected",
  "reason": "Основной адрес (Google Maps) можно изменить только в CRM. Укажите детальный адрес."
}

Если не удалось разобрать:
{
  "status": "rejected",
  "reason": "Короткое объяснение на русском"
}`;
}

/**
 * Парсит команду менеджера о дедлайне через Gemini.
 *
 * @param {string} text          — основной текст @упоминания
 * @param {{ replyText?: string }} options — контекст отсечки (может содержать номер заявки)
 * @returns {Promise<
 *   | { status: "ok", appealNumber: string, action: string, newDate?: string, infoUpdates?: object, rejectReason?: string }
 *   | { status: "rejected", reason: string }
 *   | { status: "error", error: string }
 * >}
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
    userParts.push(`\nКонтекст (сообщение, на которое менеджер сделал отсечку):\n${replyText.slice(0, 400)}`);
  }

  console.log(`[appeals-deadlines/parser] → Gemini`);

  const { text: raw, finishReason } = await generateContent({
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

  const infoUpdates = normalizeInfoUpdates(parsed);
  if (hasAnyInfoUpdate(infoUpdates)) {
    result.infoUpdates = infoUpdates;
  }

  if (parsed.reject_reason) {
    const reason = String(parsed.reject_reason).trim();
    if (reason) result.rejectReason = reason;
  }

  console.log(
    `[appeals-deadlines/parser] Gemini → ${appealNumber} ${action}` +
      (result.newDate ? ` → ${result.newDate}` : "") +
      (result.infoUpdates ? " +info" : "") +
      (result.rejectReason ? " +reason" : ""),
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
