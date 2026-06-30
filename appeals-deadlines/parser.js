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
const { getNeedsDeadlineResolutionReason } = require("./messages");

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

КОНТЕКСТ: менеджер отвечает на карточку дедлайна входящей заявки в Telegram.
Заявка считается «решённой» (карточка закроется) ТОЛЬКО если выполнено одно из:
• перенос дедлайна на новую дату (reschedule или info_added с new_date)
• отправка в погрузку (loading)
• отказ (reject)

Просто дописать телефон, комментарий или описание БЕЗ новой даты / погрузки / отказа — НЕ закрывает дедлайн.
Такие команды НЕ выполняй — верни status=rejected с понятным reason.

Сегодня (Москва): ${today}. Год для дат — ${year}, если не указан.
«Сегодня» → ${today}. «Завтра» → следующий день. «Послезавтра» → через два дня.

Ты получаешь текст сообщения менеджера и должен извлечь:
1. Номер заявки (appeal_number) — обычно #NNNNN или просто 5 цифр. Может быть только в контексте отсечки.
2. action — одно из: reschedule | reject | loading | info_added
   - reschedule: только перенести дедлайн (без доп. полей)
   - reject: отказ (любые формулировки: «в отказ», «отказали», «кинь в отказ» и т.п.)
   - loading: отправить в погрузку (= «на замер», «в замеры», «кинь на замер» — тот же флоу)
   - info_added: добавить/обновить инфо по заявке И перенести дедлайн (обязательно new_date!)
3. new_date — ОБЯЗАТЕЛЬНО для reschedule и info_added. Формат YYYY-MM-DD. Без даты — status=rejected.
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

ОБЯЗАТЕЛЬНО status=rejected если:
- просят только добавить/обновить инфо БЕЗ new_date, без loading, без reject
- action reschedule или info_added, но new_date не указана и не выводится однозначно из текста
- команда не содержит ни переноса дедлайна, ни погрузки, ни отказа

При rejection reason объясни по-русски: без переноса дедлайна / погрузки / отказа карточка не закроется.

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

Если просят только инфо без переноса / погрузки / отказа:
{
  "status": "rejected",
  "reason": "Не могу закрыть дедлайн без решения: укажите новую дату переноса, погрузку или отказ. Просто дописать данные недостаточно."
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

  if ((action === "reschedule" || action === "info_added") && !result.newDate) {
    console.log(
      `[appeals-deadlines/parser] отказ: ${appealNumber} ${action} без new_date`,
    );
    return {
      status: "rejected",
      reason: getNeedsDeadlineResolutionReason(appealNumber),
    };
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
