// ============================================================================
// CallCard — одно Telegram-сообщение на звонок: send → editMessageText.
// Очередь на карточку + короткий throttle, чтобы параллельные webhook'и
// не гоняли edit и не ловили flood.
// ============================================================================

const TELEGRAM_MAX = 4096;
const THROTTLE_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clipTelegramText(text) {
  const s = String(text || "");
  if (s.length <= TELEGRAM_MAX) return s;
  return s.slice(0, TELEGRAM_MAX - 1) + "…";
}

class CallCard {
  constructor(chatId) {
    this.chatId = chatId;
    this._messageId = null;
    this._lastUpdateAt = 0;
    this._lastText = null;
    this._chain = Promise.resolve();
  }

  get messageId() {
    return this._messageId;
  }

  /** Поставить текст в очередь: первый раз send, дальше edit. */
  sync(bot, text) {
    this._chain = this._chain
      .then(() => this._syncNow(bot, text))
      .catch((err) => {
        console.log("⚠️ CallCard sync:", err?.message || err);
      });
    return this._chain;
  }

  async _syncNow(bot, text) {
    if (!bot) return;

    const clipped = clipTelegramText(text);
    if (clipped === this._lastText) return;

    if (!this._messageId) {
      const sent = await bot.sendMessage(this.chatId, clipped, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      this._messageId = sent.message_id;
      this._lastText = clipped;
      this._lastUpdateAt = Date.now();
      return;
    }

    const elapsed = Date.now() - this._lastUpdateAt;
    if (elapsed < THROTTLE_MS) await sleep(THROTTLE_MS - elapsed);

    try {
      await bot.editMessageText(clipped, {
        chat_id: this.chatId,
        message_id: this._messageId,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      this._lastText = clipped;
      this._lastUpdateAt = Date.now();
    } catch (err) {
      if (err.message?.includes("message is not modified")) {
        this._lastText = clipped;
        return;
      }
      console.log("⚠️ CallCard edit:", err.message);
    }
  }
}

module.exports = { CallCard, clipTelegramText, TELEGRAM_MAX };
