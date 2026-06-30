// ============================================================================
// Интент: управление дедлайном входящей заявки из Telegram.
//
// Разрешение: appeal_deadline
// Зарегистрированные действия (фаза 1):
//   reschedule — перенести дедлайн (полностью реализовано)
//   reject / loading / info_added — заглушки (ответ с инструкцией вручную)
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { getTelegramBot } = require("../tgwebhook/bot");
const { parseDeadlineCommand, formatDateHuman } = require("./parser");
const {
  findAppealByNumber,
  rescheduleAppealDeadline,
} = require("./queries");
const {
  formatRescheduleConfirm,
  formatNotImplemented,
  formatAppealNotFound,
} = require("./messages");
const { runDeadlineCheck } = require("./worker");

/**
 * Финализирует статусное сообщение (с поддержкой HTML),
 * либо отправляет новое если статуса нет.
 */
async function reply(ctx, text) {
  if (ctx.statusMsg?.messageId) {
    // finalize() поддерживает parse_mode, в отличие от update()
    await ctx.statusMsg.finalize(text, null, "HTML");
  } else {
    await sendText(ctx.chatId, text, { parse_mode: "HTML" });
  }
}

async function handle(ctx) {
  const { chatId, text, replyText, profileId, msg } = ctx;

  console.log(
    `[appeals-deadlines/intent] chat=${chatId} profile=${profileId || "null"} ` +
      `text="${text.slice(0, 120)}"` +
      (replyText ? ` replyCtx="${replyText.slice(0, 60)}"` : ""),
  );

  // Парсим команду менеджера; передаём replyText чтобы извлечь
  // номер заявки из отсечки на карточку бота (если не указан в тексте).
  let parsed;
  try {
    parsed = await parseDeadlineCommand(text, { replyText });
  } catch (err) {
    console.error("[appeals-deadlines/intent] parseDeadlineCommand упал:", err.message);
    await reply(ctx, "Не удалось обработать команду. Попробуйте ещё раз.");
    return;
  }

  if (parsed.status === "error") {
    const errMsg =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : "Не удалось разобрать команду. Укажите номер заявки и действие, например:\n<code>@SUNRAYY_bot #08044 перенести дедлайн на 10 июля</code>";
    await reply(ctx, errMsg);
    return;
  }

  if (parsed.status === "rejected") {
    await reply(ctx, `⚠️ ${parsed.reason}`);
    return;
  }

  const { appealNumber, action, newDate } = parsed;

  // Заглушки для неимплементированных действий
  if (action !== "reschedule") {
    await reply(ctx, formatNotImplemented(action));
    return;
  }

  // -- reschedule --

  if (!newDate) {
    await reply(
      ctx,
      `⚠️ Не указана новая дата для переноса дедлайна ${appealNumber}.\n` +
        `Пример: <code>@SUNRAYY_bot ${appealNumber} перенести на 10 июля</code>`,
    );
    return;
  }

  // Ищем заявку в базе
  let appeal;
  try {
    appeal = await findAppealByNumber(appealNumber);
  } catch (err) {
    console.error("[appeals-deadlines/intent] findAppealByNumber:", err.message);
    await reply(ctx, "Ошибка при поиске заявки. Попробуйте позже.");
    return;
  }

  if (!appeal) {
    await reply(ctx, formatAppealNotFound(appealNumber));
    return;
  }

  // Новая дата + сброс трекинга → сегодня очередь разблокируется, в новую дату заявка снова встанет в очередь
  try {
    await rescheduleAppealDeadline(appeal.id, newDate);
  } catch (err) {
    console.error("[appeals-deadlines/intent] update:", err.message);
    await reply(ctx, "Ошибка при обновлении дедлайна. Попробуйте позже.");
    return;
  }

  const newDateHuman = formatDateHuman(newDate);

  console.log(
    `[appeals-deadlines/intent] ✅ ${appeal.appeal_number} → reschedule → ${newDate}` +
      ` (profile=${profileId})`,
  );

  await reply(ctx, formatRescheduleConfirm(appeal.appeal_number, newDateHuman));

  // Внеочередная проверка очереди — сразу после закрытия дедлайна
  const bot = getTelegramBot();
  if (bot) {
    setImmediate(() => {
      runDeadlineCheck(bot).catch((err) =>
        console.error("[appeals-deadlines/intent] внеочередной чек:", err.message),
      );
    });
  }
}

module.exports = {
  name: "appeal_deadline_manage",
  permission: PERMISSIONS.APPEAL_DEADLINE,
  title: "Управление дедлайном входящей заявки",
  description:
    "Менеджер реагирует на уведомление о дедлайне входящего обращения: переносит дедлайн, " +
    "ставит отказ, отправляет в погрузку или добавляет инфо. " +
    "Всегда упоминается номер заявки (#NNNNN) или слова «дедлайн», «заявка».",
  examples: [
    "#08044 перенести дедлайн на 10 июля",
    "заявка 08044, переносим на следующую неделю",
    "#07999 отказ",
    "08044 в погрузку",
    "перенести дедлайн #08044 на 5 июля",
    "#08044 добавить инфо и перенести",
  ],
  handle,
};
