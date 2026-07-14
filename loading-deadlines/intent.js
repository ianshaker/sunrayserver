// ============================================================================
// Интент: управление дедлайном погрузки из Telegram.
//
// Реализованы: reschedule / info_added / reject / assign_zamer / return_appeals.
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");
const { sendText } = require("../assistant/reply");
const { getTelegramBot } = require("../tgwebhook/bot");
const { parseDeadlineCommand, formatDateHuman } = require("./parser");
const {
  findLoadingEventByNumber,
  validateNewDeadlineDate,
  findExistingAppealsOtkaz,
  findExistingAppealByNumber,
} = require("./queries");
const {
  formatActionStub,
  formatEventNotFound,
  formatInvalidDate,
  formatMissingInfoUpdates,
  formatNeedsDeadlineResolution,
  formatAlreadyRejected,
  formatAlreadyInAppeals,
  formatNoAddressForAssign,
  formatSlotBusy,
  buildPreviewMessage,
} = require("./messages");
const { createDraft } = require("./draft");
const { buildPreviewKeyboard } = require("./keyboards");
const { resolveManagerLabel } = require("../appeals-deadlines/managerLabel");
const {
  hasAnyInfoUpdate,
  buildFieldPatch,
  buildDialogAppendBlock,
  buildPreviewChangeLines,
} = require("../appeals-deadlines/infoUpdates");
const { validateEventAddressForAssign } = require("./address");
const { resolveAssignableMaster } = require("./masters");
const { checkMasterAvailability } = require("./availability");

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

async function handleAssignZamer(ctx, parsed, event) {
  const { chatId, profileId } = ctx;
  const { appealNumber, masterRaw, date, startTime, endTime } = parsed;

  const addr = validateEventAddressForAssign(event);
  if (!addr.ok) {
    await reply(ctx, formatNoAddressForAssign(appealNumber, addr.reason), "HTML");
    return;
  }

  const master = resolveAssignableMaster(masterRaw);
  if (!master.ok) {
    await reply(ctx, `⚠️ ${master.reason}`);
    return;
  }

  const dateCheck = validateNewDeadlineDate(date);
  if (!dateCheck.ok) {
    await reply(ctx, formatInvalidDate(dateCheck.reason), "HTML");
    return;
  }

  const availability = await checkMasterAvailability({
    master: master.canonical,
    date,
    startTime,
    endTime,
    excludeEventId: event.id,
  });
  if (availability.hasConflict) {
    await reply(ctx, formatSlotBusy(availability.errorMessage));
    return;
  }

  const draftData = {
    chatId,
    authorProfileId: profileId,
    action: "assign_zamer",
    eventId: event.id,
    appealNumber: event.appeal_number || appealNumber,
    clientName: event.client_name,
    phone: event.phone,
    master: master.canonical,
    masterAssumed: master.assumed,
    masterTgKey: master.tgKey,
    date,
    dateHuman: formatDateHuman(date),
    startTime,
    endTime,
    cleanAddress: addr.cleanAddress,
    placeId: addr.placeId,
  };

  console.log(
    `[loading-deadlines/intent] превью ${draftData.appealNumber} → assign_zamer ` +
      `${master.canonical} ${date} ${startTime}-${endTime}`,
  );
  await sendPreview(ctx, draftData);
}

async function handle(ctx) {
  const { chatId, text, replyText, profileId, msg } = ctx;

  console.log(
    `[loading-deadlines/intent] chat=${chatId} profile=${profileId || "null"} ` +
      `text="${(text || "").slice(0, 120)}"` +
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
    console.error("[loading-deadlines/intent] parseDeadlineCommand упал:", err.message);
    await reply(ctx, "Не удалось обработать команду. Попробуйте ещё раз.");
    return;
  }

  if (parsed.status === "error") {
    const errMsg =
      parsed.error === "ai_disabled"
        ? "AI-ассистент временно недоступен."
        : parsed.error === "gemini_timeout"
          ? "AI не успел ответить. Попробуйте короче, например:\n<code>@SUNRAYY_bot назначить на Антона завтра в 14:00</code>"
          : "Не удалось разобрать команду. Укажите номер заявки и действие, например:\n<code>@SUNRAYY_bot #08044 перенести дедлайн на 10 июля</code>";
    await reply(ctx, errMsg, "HTML");
    return;
  }

  if (parsed.status === "rejected") {
    await reply(ctx, `⚠️ ${parsed.reason}`);
    return;
  }

  if (parsed.status === "stub") {
    await reply(ctx, formatActionStub(parsed.appealNumber, parsed.action), "HTML");
    return;
  }

  const { appealNumber, action, newDate, infoUpdates, rejectReason } = parsed;

  if (
    action !== "reschedule" &&
    action !== "info_added" &&
    action !== "reject" &&
    action !== "assign_zamer" &&
    action !== "return_appeals"
  ) {
    await reply(ctx, formatActionStub(appealNumber, action), "HTML");
    return;
  }

  let event;
  try {
    event = await findLoadingEventByNumber(appealNumber);
  } catch (err) {
    console.error("[loading-deadlines/intent] findLoadingEventByNumber:", err.message);
    await reply(ctx, "Ошибка при поиске заявки в погрузке. Попробуйте позже.");
    return;
  }

  if (!event) {
    await reply(ctx, formatEventNotFound(appealNumber), "HTML");
    return;
  }

  if (action === "assign_zamer") {
    await handleAssignZamer(ctx, parsed, event);
    return;
  }

  const managerLabel = await resolveManagerLabel(profileId, msg?.from);

  if (action === "return_appeals") {
    let existingAppeal = null;
    try {
      existingAppeal = await findExistingAppealByNumber(event.appeal_number || appealNumber);
    } catch (err) {
      console.error("[loading-deadlines/intent] findExistingAppealByNumber:", err.message);
    }

    if (existingAppeal) {
      await reply(ctx, formatAlreadyInAppeals(event.appeal_number || appealNumber), "HTML");
      return;
    }

    const draftData = {
      chatId,
      authorProfileId: profileId,
      action,
      eventId: event.id,
      appealNumber: event.appeal_number || appealNumber,
      clientName: event.client_name,
      phone: event.phone,
      managerLabel,
    };

    console.log(
      `[loading-deadlines/intent] превью ${draftData.appealNumber} → return_appeals`,
    );
    await sendPreview(ctx, draftData);
    return;
  }

  if (action === "reject") {
    let existingReject = null;
    try {
      existingReject = await findExistingAppealsOtkaz(event.appeal_number || appealNumber);
    } catch (err) {
      console.error("[loading-deadlines/intent] findExistingAppealsOtkaz:", err.message);
    }

    if (existingReject) {
      await reply(ctx, formatAlreadyRejected(event.appeal_number || appealNumber), "HTML");
      return;
    }

    const draftData = {
      chatId,
      authorProfileId: profileId,
      action,
      eventId: event.id,
      appealNumber: event.appeal_number || appealNumber,
      clientName: event.client_name,
      phone: event.phone,
      rejectReason: rejectReason || null,
      managerLabel,
    };

    console.log(
      `[loading-deadlines/intent] превью ${draftData.appealNumber} → reject` +
        (draftData.rejectReason ? ` reason="${draftData.rejectReason.slice(0, 40)}"` : ""),
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
  const currentDeadlineHuman = event.deadline ? formatDateHuman(event.deadline) : null;

  let fieldPatch = null;
  let dialogAppend = null;
  let previewChangeLines = null;

  if (action === "info_added") {
    const updates = infoUpdates || {};
    fieldPatch = buildFieldPatch(event, updates);
    dialogAppend = buildDialogAppendBlock(managerLabel, updates, event);
    previewChangeLines = buildPreviewChangeLines(event, updates);
  }

  const draftData = {
    chatId,
    authorProfileId: profileId,
    action,
    eventId: event.id,
    appealNumber: event.appeal_number || appealNumber,
    clientName: event.client_name,
    currentDeadline: event.deadline,
    currentDeadlineHuman,
    newDate,
    newDateHuman,
    infoUpdates: infoUpdates || null,
    fieldPatch,
    dialogAppend,
    managerLabel,
    previewChangeLines,
  };

  console.log(
    `[loading-deadlines/intent] превью ${draftData.appealNumber} → ${action} → ${newDate}` +
      ` (profile=${profileId})`,
  );

  await sendPreview(ctx, draftData);
}

module.exports = {
  name: "loading_deadline_manage",
  permission: PERMISSIONS.LOADING_DEADLINE,
  title: "Управление дедлайном погрузки",
  description:
    "Менеджер ДЕЙСТВУЕТ по событию в отделе погрузки: переносит дедлайн, " +
    "добавляет инфо (телефон, детальный адрес, диалог) вместе с новой датой, " +
    "отправляет в отказ, возвращает во входящие, или назначает замер мастеру (мастер + дата + время). " +
    "Обычно есть номер заявки (#NNNNN) или reply на карточку «ДЕДЛАЙН ПОГРУЗКИ #…». " +
    "В чате с правом loading_deadline команды «перенеси дедлайн» / «отказ» / «верни во входящие» / «назначь на Антона» — про погрузку. " +
    "НЕ для вопросов «какие/дай/скинь дедлайны» — это loading_deadline_query. " +
    "НЕ путать с дедлайнами входящих (appeal_deadline_*).",
  examples: [
    "#08044 перенести дедлайн на 10 июля",
    "#08044 отказ",
    "#08044 вернуть во входящие",
    "верни во входящие (reply на карточку ДЕДЛАЙН ПОГРУЗКИ)",
    "#08044 назначить на Антона завтра в 14:00",
    "назначь замер Роме на 10 июля в 11 (reply на карточку ДЕДЛАЙН ПОГРУЗКИ)",
    "#08044 замер Тимуру сегодня в 16",
    "#08044 добавить тел 89936014136, перенести на завтра",
  ],
  handle,
};
