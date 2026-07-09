// ============================================================================
// Интент: расписание мастеров через нейро-ассистента («Расписание AI»).
//
// Поток: текст/голос менеджера → Gemini понимает запрос (кто, когда) →
// код резолвит имя мастера по whitelist → код читает eventsnew → код
// детерминированно рендерит слоты → (опц.) Gemini добавляет короткий
// комментарий сверху, прошедший проверку на соответствие данным.
//
// Никогда не отвечаем на основе того, что "придумала" модель — только на
// основе строк, реально найденных в БД. См. .cursor/rules — здесь ошибка
// хирургическая и недопустима.
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { parseScheduleQuery } = require("./parser");
const { resolveMasterName } = require("./masterAliases");
const { getMasterEventsForDate, filterByTimeRange } = require("./queries");
const { renderScheduleAnswer } = require("./render");
const { buildCommentary } = require("./commentary");

async function reply(ctx, text) {
  if (ctx.statusMsg?.messageId) {
    await ctx.statusMsg.update(text);
  } else {
    await sendText(ctx.chatId, text);
  }
}

async function buildMasterResult(rawName, date, queryType, timeFrom, timeTo) {
  const resolved = resolveMasterName(rawName);
  if (!resolved.found) {
    return { ...resolved, events: [] };
  }

  let events = await getMasterEventsForDate(resolved.canonical, date);
  if (queryType === "time_point") {
    events = filterByTimeRange(events, timeFrom, timeTo);
  }
  return { ...resolved, events };
}

async function handle(ctx) {
  const { chatId, text } = ctx;

  console.log(`[schedule-ai] старт chat=${chatId} text="${text.slice(0, 100)}"`);

  let parsed;
  try {
    parsed = await parseScheduleQuery(text, { replyText: ctx.replyText });
  } catch (error) {
    console.error("[schedule-ai] парсинг упал:", error.message);
    await reply(ctx, "Не удалось обработать запрос о расписании. Попробуйте позже.");
    return;
  }

  if (parsed.status === "error") {
    const errMsg =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать запрос. Сформулируйте вопрос иначе — укажите мастера и дату.";
    await reply(ctx, errMsg);
    return;
  }

  if (parsed.status === "unsupported") {
    console.log(`[schedule-ai] unsupported: ${parsed.message}`);
    await reply(ctx, `🚧 ${parsed.message}`);
    return;
  }

  if (parsed.status === "clarify") {
    console.log(`[schedule-ai] clarify: ${parsed.question}`);
    await reply(ctx, `❓ ${parsed.question}`);
    return;
  }

  const { mastersRaw, date, queryType, timeFrom, timeTo } = parsed;

  let mastersResults;
  try {
    mastersResults = await Promise.all(
      mastersRaw.map((raw) => buildMasterResult(raw, date, queryType, timeFrom, timeTo)),
    );
  } catch (error) {
    console.error("[schedule-ai] ошибка запроса к eventsnew:", error.message);
    await reply(ctx, "Не удалось получить расписание из базы — попробуйте позже.");
    return;
  }

  const anyFound = mastersResults.some((mr) => mr.found);
  if (!anyFound) {
    const names = mastersResults.map((mr) => `«${mr.raw}»`).join(", ");
    await reply(ctx, `❓ Не нашёл мастера ${names} в списке — уточните имя.`);
    return;
  }

  let commentary = null;
  try {
    commentary = await buildCommentary(text, mastersResults.filter((mr) => mr.found), {
      queryType,
      date,
      timeFrom,
      timeTo,
    });
  } catch (error) {
    console.error("[schedule-ai] ошибка комментария:", error.message);
  }

  const answer = renderScheduleAnswer({
    mastersResults,
    date,
    queryType,
    timeFrom,
    timeTo,
    commentary,
  });

  console.log(
    `[schedule-ai] ответ chat=${chatId}: мастера=[${mastersResults.map((m) => m.canonical || m.raw).join(",")}], дата=${date}, событий=${mastersResults.reduce((s, m) => s + m.events.length, 0)}`,
  );

  await reply(ctx, answer);
}

module.exports = {
  name: "master_schedule_query",
  permission: PERMISSIONS.MASTER_SCHEDULE,
  title: "Расписание мастеров (AI)",
  description:
    "Менеджер спрашивает про расписание, график или занятость мастера/монтажника/замерщика на определённый день или конкретное время: какие у него слоты, что запланировано, свободен ли в определённое время. Это ТОЛЬКО просмотр расписания — без создания задач и без действий над заявками.",
  examples: [
    "Дай расписание Леши на завтра",
    "Что у Антона и Леши завтра?",
    "Что завтра у Леши в 13 часов?",
    "Покажи график Алексея на понедельник",
    "Свободен ли Тимур завтра в 15:30?",
  ],
  handle,
};
