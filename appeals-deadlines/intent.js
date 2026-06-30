// ============================================================================
// Интент: управление дедлайном входящей заявки из Telegram.
//
// reschedule / info_added / loading / reject — превью + «Сохранить / Отменить».
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { getTelegramBot } = require("../tgwebhook/bot");
const { parseDeadlineCommand, formatDateHuman } = require("./parser");
const {
  findAppealByNumber,
  validateNewDeadlineDate,
  findExistingLoadingEvent,
  findExistingReject,
} = require("./queries");
const {
  formatNotImplemented,
  formatAppealNotFound,
  formatInvalidDate,
  formatMissingInfoUpdates,
  formatNeedsDeadlineResolution,
  formatAlreadyInLoading,
  formatAlreadyRejected,
  buildPreviewMessage,
} = require("./messages");
const { createDraft } = require("./draft");
const { buildPreviewKeyboard } = require("./keyboards");
const { resolveManagerLabel } = require("./managerLabel");
const { resolveSalesManagerFromProfile } = require("./salesManager");
const {
  hasAnyInfoUpdate,
  buildFieldPatch,
  buildDialogAppendBlock,
  buildPreviewChangeLines,
  mergeAppealForLoading,
} = require("./infoUpdates");

async function reply(ctx, text, parseMode) {
  if (ctx.statusMsg?.messageId) {
    await ctx.statusMsg.finalize(text, null, parseMode || undefined);
  } else {
    await sendText(ctx.chatId, text, parseMode ? { parse_mode: parseMode } : undefined);
  }
}

async function sendPreview(ctx, draftData) {
  const draftId = createDraft(draftData);
  const preview = buildPreviewMessage(draftData);
  const keyboard = buildPreviewKeyboard(draftId);
  const bot = getTelegramBot();

  if (ctx.statusMsg?.messageId) {
    await ctx.statusMsg.finalize(preview.text, keyboard, preview.parseMode);
    return;
  }

  if (bot) {
    await bot.sendMessage(ctx.chatId, preview.text, {
      disable_web_page_preview: true,
      reply_markup: keyboard,
      parse_mode: preview.parseMode,
    });
  } else {
    await sendText(ctx.chatId, preview.text, { parse_mode: preview.parseMode });
  }
}

async function handle(ctx) {
  const { chatId, text, replyText, profileId, msg } = ctx;

  console.log(
    `[appeals-deadlines/intent] chat=${chatId} profile=${profileId || "null"} ` +
      `text="${text.slice(0, 120)}"` +
      (replyText ? ` replyCtx="${replyText.slice(0, 60)}"` : ""),
  );

  if (!profileId) {
    await reply(
      ctx,
      "Вы не зарегистрированы в системе менеджеров — действие не выполнено. Обратитесь к администратору.",
    );
    return;
  }

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
    await reply(ctx, errMsg, "HTML");
    return;
  }

  if (parsed.status === "rejected") {
    await reply(ctx, `⚠️ ${parsed.reason}`);
    return;
  }

  const { appealNumber, action, newDate, infoUpdates, rejectReason } = parsed;

  if (action === "reject") {
    let appeal;
    try {
      appeal = await findAppealByNumber(appealNumber);
    } catch (err) {
      console.error("[appeals-deadlines/intent] findAppealByNumber:", err.message);
      await reply(ctx, "Ошибка при поиске заявки. Попробуйте позже.");
      return;
    }

    if (!appeal) {
      await reply(ctx, formatAppealNotFound(appealNumber), "HTML");
      return;
    }

    let existingReject = null;
    try {
      existingReject = await findExistingReject(appeal.appeal_number || appealNumber);
    } catch (err) {
      console.error("[appeals-deadlines/intent] findExistingReject:", err.message);
    }

    if (existingReject) {
      await reply(ctx, formatAlreadyRejected(appeal.appeal_number || appealNumber), "HTML");
      return;
    }

    const draftData = {
      chatId,
      authorProfileId: profileId,
      action,
      appealId: appeal.id,
      appealNumber: appeal.appeal_number || appealNumber,
      clientName: appeal.client_name,
      phone: appeal.phone,
      rejectReason: rejectReason || null,
    };

    console.log(
      `[appeals-deadlines/intent] превью ${draftData.appealNumber} → reject` +
        (draftData.rejectReason ? ` reason="${draftData.rejectReason.slice(0, 40)}"` : ""),
    );
    await sendPreview(ctx, draftData);
    return;
  }

  if (action !== "reschedule" && action !== "info_added" && action !== "loading") {
    await reply(ctx, formatNotImplemented(action), "HTML");
    return;
  }

  let appeal;
  try {
    appeal = await findAppealByNumber(appealNumber);
  } catch (err) {
    console.error("[appeals-deadlines/intent] findAppealByNumber:", err.message);
    await reply(ctx, "Ошибка при поиске заявки. Попробуйте позже.");
    return;
  }

  if (!appeal) {
    await reply(ctx, formatAppealNotFound(appealNumber), "HTML");
    return;
  }

  const managerLabel = await resolveManagerLabel(profileId, msg?.from);

  if (action === "loading") {
    let existingLoading = null;
    try {
      existingLoading = await findExistingLoadingEvent(appeal.appeal_number || appealNumber);
    } catch (err) {
      console.error("[appeals-deadlines/intent] findExistingLoadingEvent:", err.message);
    }

    if (existingLoading) {
      await reply(ctx, formatAlreadyInLoading(appeal.appeal_number || appealNumber), "HTML");
      return;
    }

    const { salemanager } = await resolveSalesManagerFromProfile(profileId);
    const loadingSnapshot = mergeAppealForLoading(appeal, infoUpdates, managerLabel);
    const previewChangeLines = infoUpdates && hasAnyInfoUpdate(infoUpdates)
      ? buildPreviewChangeLines(appeal, infoUpdates)
      : [];

    const draftData = {
      chatId,
      authorProfileId: profileId,
      action,
      appealId: appeal.id,
      appealNumber: appeal.appeal_number || appealNumber,
      salemanager,
      managerLabel,
      loadingSnapshot,
      previewChangeLines,
      productType: appeal.product_type,
    };

    console.log(
      `[appeals-deadlines/intent] превью ${draftData.appealNumber} → loading (salemanager=${salemanager})`,
    );
    await sendPreview(ctx, draftData);
    return;
  }

  if (!newDate) {
    await reply(ctx, formatNeedsDeadlineResolution(appealNumber), "HTML");
    return;
  }

  const dateCheck = validateNewDeadlineDate(newDate);
  if (!dateCheck.ok) {
    await reply(ctx, formatInvalidDate(dateCheck.reason), "HTML");
    return;
  }

  if (action === "info_added" && !hasAnyInfoUpdate(infoUpdates || {})) {
    await reply(ctx, formatMissingInfoUpdates(appealNumber), "HTML");
    return;
  }

  const newDateHuman = formatDateHuman(newDate);
  const currentReminderHuman = appeal.reminder_date
    ? formatDateHuman(appeal.reminder_date)
    : null;

  let fieldPatch = null;
  let dialogAppend = null;
  let previewChangeLines = null;

  if (action === "info_added") {
    const updates = infoUpdates || {};
    fieldPatch = buildFieldPatch(appeal, updates);
    dialogAppend = buildDialogAppendBlock(managerLabel, updates, appeal);
    previewChangeLines = buildPreviewChangeLines(appeal, updates);
  }

  const draftData = {
    chatId,
    authorProfileId: profileId,
    action,
    appealId: appeal.id,
    appealNumber: appeal.appeal_number || appealNumber,
    clientName: appeal.client_name,
    currentReminderDate: appeal.reminder_date,
    currentReminderHuman,
    newDate,
    newDateHuman,
    infoUpdates: infoUpdates || null,
    fieldPatch,
    dialogAppend,
    managerLabel,
    previewChangeLines,
  };

  console.log(
    `[appeals-deadlines/intent] превью ${draftData.appealNumber} → ${action} → ${newDate}` +
      ` (profile=${profileId})`,
  );

  await sendPreview(ctx, draftData);
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
    "#08044 перенести на сегодня",
    "#08044 в погрузку",
    "#08044 добавить имя Мария и кинуть в погрузку",
    "#07999 отказ",
    "#08044 отказ: клиент передумал",
    "отказ — дорого (reply на карточку дедлайна)",
    "#08044 добавить инфо: имя клиента Мария, адрес подъезд 2, перенести на 10 июля",
  ],
  handle,
};
