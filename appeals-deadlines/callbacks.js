// ============================================================================
// Кнопки превью дедлайна входящей: «Сохранить» / «Отменить».
// ============================================================================

const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("../tasks/directory");
const { takeDraft, getDraft } = require("./draft");
const { parsePreviewCallback } = require("./keyboards");
const {
  buildPreviewDismissedMessage,
  formatRescheduleConfirm,
  formatSameDayRescheduleQueueWarning,
  formatAppealNotFound,
  formatLoadingConfirm,
  formatRejectConfirm,
  formatAlreadyInLoading,
  formatAlreadyRejected,
} = require("./messages");
const {
  findAppealByNumber,
  rescheduleAppealDeadline,
  applyInfoAddedAndRescheduleAppeal,
  getMskTodayDate,
} = require("./queries");
const { deleteDeadlineReminderMessage } = require("./notifier");
const { executeAppealLoading } = require("./loading");
const { executeAppealReject } = require("./reject");
const { runDeadlineCheck } = require("./worker");

async function answerCallback(callbackQuery, text) {
  const bot = getTelegramBot();
  if (!bot) return;
  try {
    await bot.answerCallbackQuery(callbackQuery.id, { text });
  } catch (error) {
    console.error("[appeals-deadlines/callbacks] answerCallbackQuery:", error.message);
  }
}

async function editMessage(ctx, text, parseMode) {
  const bot = getTelegramBot();
  if (!bot) return;
  await bot.editMessageText(text, {
    chat_id: ctx.chatId,
    message_id: ctx.messageId,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
    ...(parseMode ? { parse_mode: parseMode } : {}),
  });
}

function triggerDeadlineCheck() {
  const bot = getTelegramBot();
  if (!bot) return;
  setImmediate(() => {
    runDeadlineCheck(bot).catch((err) =>
      console.error("[appeals-deadlines/callbacks] внеочередной чек:", err.message),
    );
  });
}

/**
 * Перенос «сегодня → сегодня»: отдельное SMS про блокировку очереди входящих.
 */
async function maybeSendSameDayQueueWarning(chatId, replyToMsgId, appeal, confirmed) {
  const today = getMskTodayDate();
  const fromToday = appeal.reminder_date === today;
  const toToday = confirmed.newDate === today;
  if (!fromToday || !toToday) return;

  const bot = getTelegramBot();
  if (!bot) return;

  const text = formatSameDayRescheduleQueueWarning(
    confirmed.appealNumber,
    confirmed.newDateHuman,
  );

  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyToMsgId != null ? { reply_to_message_id: replyToMsgId } : {}),
    });
    console.log(
      `[appeals-deadlines/callbacks] same-day queue warning ${confirmed.appealNumber} (chat ${chatId})`,
    );
  } catch (err) {
    console.error(
      "[appeals-deadlines/callbacks] same-day queue warning failed:",
      err.message,
    );
  }
}

function registerAppealDeadlineCallbacks() {
  onCallbackQuery(async (callbackQuery) => {
    const parsed = parsePreviewCallback(callbackQuery.data);
    if (!parsed) return;

    const { action, draftId } = parsed;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    if (chatId == null || messageId == null) return;

    const ctx = { chatId, messageId };

    const draft = getDraft(draftId);
    if (!draft) {
      await answerCallback(callbackQuery, "Черновик устарел — пришлите команду заново");
      try {
        await editMessage(ctx, "⌛️ Черновик устарел. Пришлите команду заново.");
      } catch (_) {}
      return;
    }

    const presserProfileId = await resolveProfileIdByTelegramUser(callbackQuery.from);
    if (presserProfileId !== draft.authorProfileId) {
      await answerCallback(callbackQuery, "Только автор команды может подтвердить");
      return;
    }

    if (action === "cancel") {
      takeDraft(draftId);
      await editMessage(ctx, buildPreviewDismissedMessage());
      await answerCallback(callbackQuery, "Отменено");
      console.log(`[appeals-deadlines/callbacks] отмена draft ${draftId} (chat ${chatId})`);
      return;
    }

    if (action !== "save") return;

    const confirmed = takeDraft(draftId);
    if (!confirmed) {
      await answerCallback(callbackQuery, "Черновик устарел — пришлите команду заново");
      return;
    }

    let appeal;
    try {
      appeal = await findAppealByNumber(confirmed.appealNumber);
    } catch (error) {
      console.error("[appeals-deadlines/callbacks] findAppealByNumber:", error.message);
      await answerCallback(callbackQuery, "Не удалось получить заявку");
      return;
    }

    if (!appeal) {
      await editMessage(ctx, formatAppealNotFound(confirmed.appealNumber), "HTML");
      await answerCallback(callbackQuery, "Заявка не найдена");
      return;
    }

    // Убрать висящий ⏰-пинг до сброса трекинга / удаления заявки.
    await deleteDeadlineReminderMessage(getTelegramBot(), appeal.deadline_reminder_tg_msg_id);

    try {
      if (confirmed.action === "reschedule") {
        await rescheduleAppealDeadline(appeal.id, confirmed.newDate);
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman),
          "HTML",
        );
        await maybeSendSameDayQueueWarning(chatId, messageId, appeal, confirmed);
        await answerCallback(callbackQuery, `Дедлайн ${confirmed.appealNumber} перенесён`);
        console.log(
          `[appeals-deadlines/callbacks] reschedule ${confirmed.appealNumber} → ${confirmed.newDate} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "info_added") {
        await applyInfoAddedAndRescheduleAppeal(appeal.id, confirmed.newDate, {
          fieldPatch: confirmed.fieldPatch || {},
          dialogAppend: confirmed.dialogAppend,
        });
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman) +
            "\n💬 Данные по заявке обновлены.",
          "HTML",
        );
        await maybeSendSameDayQueueWarning(chatId, messageId, appeal, confirmed);
        await answerCallback(callbackQuery, `Инфо добавлено, дедлайн перенесён`);
        console.log(
          `[appeals-deadlines/callbacks] info_added ${confirmed.appealNumber} → ${confirmed.newDate} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "loading") {
        const result = await executeAppealLoading(
          { ...appeal, product_type: confirmed.productType || appeal.product_type },
          confirmed.loadingSnapshot,
          confirmed.salemanager,
        );
        await editMessage(
          ctx,
          formatLoadingConfirm(confirmed.appealNumber, {
            telegramSent: result.telegramSent,
          }),
          "HTML",
        );
        await answerCallback(callbackQuery, `${confirmed.appealNumber} отправлена в погрузку`);
        console.log(
          `[appeals-deadlines/callbacks] loading ${confirmed.appealNumber} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "reject") {
        await executeAppealReject(appeal, confirmed.rejectReason);
        await editMessage(ctx, formatRejectConfirm(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, `${confirmed.appealNumber} отправлена в отказ`);
        console.log(
          `[appeals-deadlines/callbacks] reject ${confirmed.appealNumber} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }
    } catch (error) {
      if (error.message === "already_in_loading") {
        await editMessage(ctx, formatAlreadyInLoading(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Уже в погрузке");
        return;
      }
      if (error.message === "already_rejected") {
        await editMessage(ctx, formatAlreadyRejected(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Уже в отказах");
        return;
      }
      console.error(`[appeals-deadlines/callbacks] ошибка ${confirmed.action}:`, error.message);
      await answerCallback(callbackQuery, "Не удалось выполнить действие");
    }
  });

  console.log("[appeals-deadlines] кнопки превью: сохранить / отменить");
}

module.exports = { registerAppealDeadlineCallbacks };
