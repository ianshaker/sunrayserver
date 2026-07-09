// ============================================================================
// StatusMessage — одно сообщение, которое редактируется по мере обработки:
//   "Вижу меня отметили..." → "Расшифровываю голосовое..." → "Думаю..." → превью
//
// finalize() превращает статусное сообщение в превью с кнопками.
// Минимальное время показа каждого статуса — MIN_STATUS_MS (1 сек).
// ============================================================================

const MIN_STATUS_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class StatusMessage {
  constructor(bot, chatId, replyToMsgId = null) {
    this.bot = bot;
    this.chatId = chatId;
    this.replyToMsgId = replyToMsgId;
    this._messageId = null;
    this._lastUpdateAt = 0;
  }

  async send(text) {
    if (!this.bot) return this;
    try {
      const opts = { disable_web_page_preview: true };
      if (this.replyToMsgId) opts.reply_to_message_id = this.replyToMsgId;
      const sent = await this.bot.sendMessage(this.chatId, text, opts);
      this._messageId = sent.message_id;
      this._lastUpdateAt = Date.now();
    } catch (err) {
      console.error("[statusMessage] send:", err.message);
    }
    return this;
  }

  async update(text, minMs = MIN_STATUS_MS, options = {}) {
    if (!this._messageId || !this.bot) return;
    const elapsed = Date.now() - this._lastUpdateAt;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    try {
      await this.bot.editMessageText(text, {
        chat_id: this.chatId,
        message_id: this._messageId,
        disable_web_page_preview: true,
        ...options,
      });
      this._lastUpdateAt = Date.now();
    } catch (err) {
      if (!err.message?.includes("message is not modified")) {
        console.error("[statusMessage] update:", err.message);
      }
    }
  }

  /** Превращает статусное сообщение в превью с кнопками. */
  async finalize(text, replyMarkup, parseMode) {
    if (!this._messageId || !this.bot) return null;
    const elapsed = Date.now() - this._lastUpdateAt;
    if (elapsed < MIN_STATUS_MS) await sleep(MIN_STATUS_MS - elapsed);
    const opts = {
      chat_id: this.chatId,
      message_id: this._messageId,
      disable_web_page_preview: true,
      reply_markup: replyMarkup || { inline_keyboard: [] },
    };
    if (parseMode) opts.parse_mode = parseMode;
    try {
      await this.bot.editMessageText(text, opts);
      return this._messageId;
    } catch (err) {
      console.error("[statusMessage] finalize:", err.message);
      return null;
    }
  }

  get messageId() {
    return this._messageId;
  }
}

module.exports = { StatusMessage };
