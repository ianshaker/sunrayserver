// ============================================================================
// Кнопки превью дедлайна погрузки: «Сохранить» / «Отменить».
// ============================================================================

const { onCallbackQuery } = require("../tgwebhook");
const { getTelegramBot } = require("../tgwebhook/bot");
const { resolveProfileIdByTelegramUser } = require("../tasks/directory");
const { takeDraft, getDraft } = require("./draft");
const {
  parsePreviewCallback,
  parseCardCallback,
  buildCardKeyboard,
  buildRejectConfirmKeyboard,
} = require("./keyboards");
const { LOADING_DEADLINE_CHAT_ID } = require("./config");
const {
  buildPreviewDismissedMessage,
  formatRescheduleConfirm,
  formatSameDayRescheduleQueueWarning,
  formatEventNotFound,
  formatRejectConfirm,
  formatAlreadyRejected,
  formatAlreadyInAppeals,
  formatReturnAppealsConfirm,
  formatAssignConfirm,
  formatAssignTelegramFailed,
  formatNoAddressForAssign,
  formatSlotBusy,
  formatDeadlineCard,
  formatCardActionTail,
  formatIsoDateHuman,
} = require("./messages");
const {
  findLoadingEventByNumber,
  findLoadingEventById,
  rescheduleLoadingDeadline,
  applyInfoAddedAndRescheduleLoading,
  getMskTodayDate,
  getMskNowTime,
  getMskDateOffset,
} = require("./queries");
const { deleteDeadlineReminderMessage } = require("./notifier");
const { executeLoadingReject } = require("./reject");
const { executeLoadingReturnAppeals } = require("./returnAppeals");
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

/**
 * Перенос «сегодня → сегодня»: отдельное SMS про блокировку очереди.
 * Не трогает текст подтверждения — отдельное сообщение после него.
 */
async function maybeSendSameDayQueueWarning(chatId, replyToMsgId, event, confirmed) {
  const today = getMskTodayDate();
  const fromToday = event.deadline === today;
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
      `[loading-deadlines/callbacks] same-day queue warning ${confirmed.appealNumber} (chat ${chatId})`,
    );
  } catch (err) {
    console.error(
      "[loading-deadlines/callbacks] same-day queue warning failed:",
      err.message,
    );
  }
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
        await rescheduleLoadingDeadline(
          event.id,
          confirmed.newDate,
          confirmed.newTime !== undefined ? confirmed.newTime : undefined,
        );
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman),
          "HTML",
        );
        await maybeSendSameDayQueueWarning(chatId, messageId, event, confirmed);
        await answerCallback(callbackQuery, `Дедлайн ${confirmed.appealNumber} перенесён`);
        console.log(
          `[loading-deadlines/callbacks] reschedule ${confirmed.appealNumber} → ${confirmed.newDate}` +
            (confirmed.newTime ? ` ${confirmed.newTime}` : "") +
            ` (chat ${chatId})`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (confirmed.action === "info_added") {
        await applyInfoAddedAndRescheduleLoading(event.id, confirmed.newDate, {
          fieldPatch: confirmed.fieldPatch || {},
          dialogAppend: confirmed.dialogAppend,
          newTime: confirmed.newTime !== undefined ? confirmed.newTime : undefined,
        });
        await editMessage(
          ctx,
          formatRescheduleConfirm(confirmed.appealNumber, confirmed.newDateHuman) +
            "\n💬 Данные по заявке обновлены.",
          "HTML",
        );
        await maybeSendSameDayQueueWarning(chatId, messageId, event, confirmed);
        await answerCallback(callbackQuery, "Инфо добавлено, дедлайн перенесён");
        console.log(
          `[loading-deadlines/callbacks] info_added ${confirmed.appealNumber} → ${confirmed.newDate}` +
            (confirmed.newTime ? ` ${confirmed.newTime}` : "") +
            ` (chat ${chatId})`,
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

      if (confirmed.action === "return_appeals") {
        await executeLoadingReturnAppeals(event);
        await editMessage(ctx, formatReturnAppealsConfirm(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, `${confirmed.appealNumber} возвращена во входящие`);
        console.log(
          `[loading-deadlines/callbacks] return_appeals ${confirmed.appealNumber} (chat ${chatId})`,
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
      if (error.message === "already_in_appeals") {
        await editMessage(ctx, formatAlreadyInAppeals(confirmed.appealNumber), "HTML");
        await answerCallback(callbackQuery, "Уже во входящих");
        return;
      }
      if (error.message === "missing_appeal_number") {
        await editMessage(
          ctx,
          "⚠️ У события нет номера заявки — возврат во входящие невозможен.",
        );
        await answerCallback(callbackQuery, "Нет номера заявки");
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


// ============================================================================
// Кнопки под самой карточкой дедлайна: «Завтра», «+3 дня», «+7 дней», «Отказ».
//
// Зачем: чтобы сдвинуть дедлайн, менеджеру приходилось писать боту отдельным
// сообщением с отметкой @бота — и почти никто этого не делал. Кнопка — прямое
// действие человека, отметка для неё не нужна, а слушать чат бот по-прежнему
// не начинает.
// ============================================================================

/** Кто нажал — для хвоста карточки и лога. */
function describePresser(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (from?.username) return `@${from.username}`;
  return `tg:${from?.id ?? "?"}`;
}

/** Перерисовывает карточку с хвостом о выполненном действии и без кнопок. */
async function rewriteCardWithTail(chatId, messageId, event, what, who) {
  const bot = getTelegramBot();
  const { text, parseMode } = formatDeadlineCard(event);
  const tail = formatCardActionTail(what, who, getMskTodayDate(), getMskNowTime());
  await bot.editMessageText(text + tail, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
}

async function setCardKeyboard(chatId, messageId, keyboard) {
  const bot = getTelegramBot();
  await bot.editMessageReplyMarkup(keyboard, { chat_id: chatId, message_id: messageId });
}

const SHIFT_DAYS = { d1: 1, d3: 3, d7: 7 };

function registerLoadingDeadlineCardButtons() {
  onCallbackQuery(async (callbackQuery) => {
    const parsed = parseCardCallback(callbackQuery.data);
    if (!parsed) return;

    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    if (chatId == null || messageId == null) return;
    // Кнопки живут только под карточками в чате погрузки.
    if (chatId !== LOADING_DEADLINE_CHAT_ID) return;

    const { action, eventId } = parsed;
    const who = describePresser(callbackQuery.from);

    // Отказ удаляет событие и заводит отказ — спрашиваем второй раз.
    if (action === "rej") {
      await setCardKeyboard(chatId, messageId, buildRejectConfirmKeyboard(eventId));
      await answerCallback(callbackQuery, "Точно отказ?");
      return;
    }
    if (action === "rjn") {
      await setCardKeyboard(chatId, messageId, buildCardKeyboard(eventId));
      await answerCallback(callbackQuery, "Отменено");
      return;
    }

    let event;
    try {
      event = await findLoadingEventById(eventId);
    } catch (error) {
      console.error("[loading-deadlines/card] findLoadingEventById:", error.message);
      await answerCallback(callbackQuery, "Не удалось получить заявку");
      return;
    }

    if (!event) {
      await setCardKeyboard(chatId, messageId, { inline_keyboard: [] });
      await answerCallback(callbackQuery, "Заявка уже закрыта");
      return;
    }

    const bot = getTelegramBot();

    try {
      if (SHIFT_DAYS[action]) {
        const newDate = getMskDateOffset(SHIFT_DAYS[action]);
        await deleteDeadlineReminderMessage(bot, event.deadline_reminder_tg_msg_id);
        await rescheduleLoadingDeadline(event.id, newDate);
        await rewriteCardWithTail(
          chatId,
          messageId,
          event,
          `перенесён на ${formatIsoDateHuman(newDate)}`,
          who,
        );
        await answerCallback(callbackQuery, `Перенесено на ${formatIsoDateHuman(newDate)}`);
        console.log(
          `[loading-deadlines/card] ${event.appeal_number}: перенос на ${newDate} — ${who}`,
        );
        triggerDeadlineCheck();
        return;
      }

      if (action === "rjy") {
        await deleteDeadlineReminderMessage(bot, event.deadline_reminder_tg_msg_id);
        await executeLoadingReject(event, "Отказ кнопкой под карточкой дедлайна", who);
        await rewriteCardWithTail(chatId, messageId, event, "отправлена в отказ", who);
        await answerCallback(callbackQuery, "Отправлена в отказ");
        console.log(`[loading-deadlines/card] ${event.appeal_number}: отказ — ${who}`);
        triggerDeadlineCheck();
        return;
      }
    } catch (error) {
      if (error.message === "already_rejected") {
        await setCardKeyboard(chatId, messageId, { inline_keyboard: [] });
        await answerCallback(callbackQuery, "Уже в отказах");
        return;
      }
      console.error(`[loading-deadlines/card] ошибка ${action}:`, error.message);
      await answerCallback(callbackQuery, "Не удалось выполнить действие");
    }
  });

  console.log("[loading-deadlines] кнопки карточки: завтра / +3 / +7 / отказ");
}

module.exports = { registerLoadingDeadlineCallbacks, registerLoadingDeadlineCardButtons };

