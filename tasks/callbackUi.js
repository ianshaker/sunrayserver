const { buildTaskActionKeyboard } = require("./keyboards");

function getMessageContext(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const text = callbackQuery.message?.text || "";
  if (chatId == null || messageId == null) return null;
  return { chatId, messageId, text };
}

async function setButtonsLoading(bot, ctx, label) {
  await bot.editMessageReplyMarkup(
    { inline_keyboard: [[{ text: label, callback_data: "mt:noop" }]] },
    { chat_id: ctx.chatId, message_id: ctx.messageId },
  );
}

async function restoreButtons(bot, ctx, taskNumber) {
  const keyboard = buildTaskActionKeyboard(taskNumber);
  if (!keyboard) return;
  await bot.editMessageReplyMarkup(keyboard, {
    chat_id: ctx.chatId,
    message_id: ctx.messageId,
  });
}

async function finishWithFooter(bot, ctx, footerLine) {
  const base = ctx.text.trimEnd();
  const alreadyHas = base.includes(footerLine);
  const text = alreadyHas ? base : `${base}\n\n${footerLine}`;

  await bot.editMessageText(text, {
    chat_id: ctx.chatId,
    message_id: ctx.messageId,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  });
}

module.exports = {
  getMessageContext,
  setButtonsLoading,
  restoreButtons,
  finishWithFooter,
};
