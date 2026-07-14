// ============================================================================
// Кнопки превью дедлайна погрузки: «Сохранить» / «Отменить».
// ============================================================================

const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("../tasks/directory");
const { takeDraft, getDraft } = require("./draft");
const { parsePreviewCallback } = require("./keyboards");
const {
  buildPreviewDismissedMessage,
  formatRescheduleConfirm,
  formatEventNotFound,
  formatRejectConfirm,
  formatAlreadyRejected,
  formatAssignConfirm,
  formatAssignTelegramFailed,
  formatNoAddressForAssign,
  formatSlotBusy,
} = require("./messages");
const {
  findLoadingEventByNumber,
  rescheduleLoadingDeadline,
  applyInfoAddedAndRescheduleLoading,
} = require("./queries");
const { deleteDeadlineReminderMessage } = require("./notifier");
const { executeLoadingReject } = require("./reject");
const { executeAssignZamer } = require("./assign");
const { runDeadlineCheck } = require("./worker");

async function answerCallback(callbackQuery, text) {
  const bot = getTelegramBot();
  if (!bot) return;
  try {
    await bot.answerCallbackQuery(callbackQuery.id, { text });
  } catch (error) {
    console.error("[loading-deadlines/callbacks] answerCallbackQuery:", error.message);
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
      console.error("[loading-deadlines/callbacks] внеочередной чек:", err.message),
    );
  });
}

function registerLoadingDeadlineCallbacks() {
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
      console.log(`[loading-deadlines/callbacks] отмена draft ${draftId} (chat ${chatId})`);
      return;
    }

    if (action !== "save") return;

    const confirmed = takeDraft(draftId);
    if (!confirmed) {
      await answerCallback(callbackQuery, "Черновик устарел — пришлите команду заново");
      return;
    }

    let event;
    try {
      event = await findLoadingEventByNumber(confirmed.appealNumber);
    } catch (error) {
      console.error("[loading-deadlines/callbacks] findLoadingEventByNumber:", error.message);
      await answerCallback(callbackQuery, "Не удалось получить заявку");
      return;
    }

    if (!event) {
      await editMessage(ctx, formatEventNotFound(confirmed.appealNumber), "HTML");
      await answerCallback(callbackQuery, "Заявка не найдена");
      return;
    }

    await deleteDeadlineReminderMessage(getTelegramBot(), event.deadline_reminder_tg_msg_id);

    try {
      if (confirmed.action === "reschedule") {
        await rescheduleLoadingDeadline(event.id, confirmed.newDate);
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman),
          "HTML",
        );
        await answerCallback(callbackQuery, `Дедлайн ${confirmed.appealNumber} перенесён`);
        console.log(
          `[loading-deadlines/callbacks] reschedule ${confirmed.appealNumber} → ${confirmed.newDate} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "info_added") {
        await applyInfoAddedAndRescheduleLoading(event.id, confirmed.newDate, {
          fieldPatch: confirmed.fieldPatch || {},
          dialogAppend: confirmed.dialogAppend,
        });
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman) +
            "\n💬 Данные по заявке обновлены.",
          "HTML",
        );
        await answerCallback(callbackQuery, "Инфо добавлено, дедлайн перенесён");
        console.log(
          `[loading-deadlines/callbacks] info_added ${confirmed.appealNumber} → ${confirmed.newDate} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "reject") {
        await executeLoadingReject(event, confirmed.rejectReason, confirmed.managerLabel);
        await editMessage(ctx, formatRejectConfirm(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, `${confirmed.appealNumber} отправлена в отказ`);
        console.log(
          `[loading-deadlines/callbacks] reject ${confirmed.appealNumber} (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "assign_zamer") {
        await executeAssignZamer({
          eventId: confirmed.eventId || event.id,
          appealNumber: confirmed.appealNumber,
          master: confirmed.master,
          date: confirmed.date,
          startTime: confirmed.startTime,
          endTime: confirmed.endTime,
          cleanAddress: confirmed.cleanAddress,
          placeId: confirmed.placeId,
        });
        await editMessage(
          ctx,
          formatAssignConfirm(
            confirmed.appealNumber,
            confirmed.master,
            confirmed.dateHuman || confirmed.date,
            confirmed.startTime,
            confirmed.endTime,
          ),
          "HTML",
        );
        await answerCallback(callbackQuery, `${confirmed.appealNumber} назначена на замер`);
        console.log(
          `[loading-deadlines/callbacks] assign_zamer ${confirmed.appealNumber} → ` +
            `${confirmed.master} ${confirmed.date} ${confirmed.startTime}-${confirmed.endTime}`,
        );
        triggerDeadlineCheck();
        return;
      }
    } catch (error) {
      if (error.message === "already_rejected") {
        await editMessage(ctx, formatAlreadyRejected(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Уже в отказах");
        return;
      }
      if (error.message === "address_invalid") {
        await editMessage(
          ctx,
          formatNoAddressForAssign(confirmed.appealNumber, error.reason),
          "HTML",
        );
        await answerCallback(callbackQuery, "Нет адреса с координатами");
        return;
      }
      if (error.message === "slot_busy") {
        await editMessage(ctx, formatSlotBusy(error.reason));
        await answerCallback(callbackQuery, "Слот занят");
        return;
      }
      if (error.message === "telegram_failed") {
        await editMessage(ctx, formatAssignTelegramFailed(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Telegram не отправился — откат");
        return;
      }
      if (error.message === "event_not_found") {
        await editMessage(ctx, formatEventNotFound(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Заявка не найдена");
        return;
      }
      console.error(`[loading-deadlines/callbacks] ошибка ${confirmed.action}:`, error.message);
      await answerCallback(callbackQuery, "Не удалось выполнить действие");
    }
  });

  console.log("[loading-deadlines] кнопки превью: сохранить / отменить");
}

module.exports = { registerLoadingDeadlineCallbacks };
