// ============================================================================
// «Бот CRM» — тот же @SUNRAYY_bot, но разговор идёт из CRM (PLANS/CRM/18-neyrobot-na-glavnoy, буква А).
//
// Умения не переписываются: на время запроса из CRM tgwebhook/bot.js отдаёт этого бота вместо настоящего
// (runWithBot). Всё, что умение шлёт в чат разговора, копится здесь и уходит в CRM ответом; всё, что оно шлёт
// в другие чаты (погрузка, мастера), уходит настоящим Telegram — как из Telegram.
//
// Чат разговора у человека постоянный (номер ниже любых чатов Telegram), сообщения хранятся час — кнопки под
// превью (буква В) правят сообщение, отправленное прошлым запросом. Номера сообщений сквозные на процесс.
// ============================================================================

const crypto = require("node:crypto");
const { getRealTelegramBot } = require("../tgwebhook/bot");

// Супергруппы Telegram — около −1,0·10¹², личные чаты положительные: ниже −9·10¹² чатов Telegram нет
const CRM_CHAT_BASE = -9_000_000_000_000;
const RAZGOVOR_TTL_MS = 60 * 60 * 1000; // как черновики умений (tasks/create/config.js)

/** chatId → { messages: Map<messageId, сообщение>, touchedAt } */
const razgovory = new Map();
let nextMessageId = 1;

function sweep(now = Date.now()) {
  for (const [chatId, r] of razgovory) {
    if (now - r.touchedAt > RAZGOVOR_TTL_MS) razgovory.delete(chatId);
  }
}

/** Постоянный чат CRM человека: из id профиля, число ниже CRM_CHAT_BASE */
function crmChatIdFor(profileId) {
  const n = parseInt(crypto.createHash("sha1").update(String(profileId)).digest("hex").slice(0, 8), 16);
  return CRM_CHAT_BASE - n;
}

function isCrmChat(chatId) {
  const n = Number(chatId);
  return Number.isFinite(n) && n <= CRM_CHAT_BASE;
}

function razgovor(chatId) {
  let r = razgovory.get(chatId);
  if (!r) {
    r = { messages: new Map(), touchedAt: Date.now() };
    razgovory.set(chatId, r);
  }
  r.touchedAt = Date.now();
  return r;
}

function real() {
  const bot = getRealTelegramBot();
  if (!bot) throw new Error("CrmBot: настоящий бот Telegram не задан — в чужой чат не отправить");
  return bot;
}

/** Ошибка как у Telegram: StatusMessage и умения узнают её по тексту */
function telegramError(description) {
  const e = new Error(`ETELEGRAM: 400 Bad Request: ${description}`);
  e.code = "ETELEGRAM";
  return e;
}

class CrmBot {
  /** @param {number} chatId — crmChatIdFor(profileId) */
  constructor(chatId) {
    if (!isCrmChat(chatId)) throw new Error(`CrmBot: ${chatId} — не чат CRM`);
    this.chatId = chatId;
    this.izmeneny = new Set();
    this.udaleny = new Set();
    this.toasts = [];
    this.vChuzhieChaty = 0;
    sweep();
  }

  svoy(chatId) {
    return Number(chatId) === this.chatId;
  }

  async sendMessage(chatId, text, opts = {}) {
    if (!this.svoy(chatId)) {
      this.vChuzhieChaty += 1;
      return real().sendMessage(chatId, text, opts);
    }
    const id = nextMessageId++;
    const m = {
      message_id: id,
      chat: { id: this.chatId, type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: String(text),
      parse_mode: opts.parse_mode || null,
      reply_markup: opts.reply_markup || null,
      reply_to_message_id: opts.reply_to_message_id || null,
    };
    razgovor(this.chatId).messages.set(id, m);
    this.izmeneny.add(id);
    return { ...m };
  }

  async editMessageText(text, opts = {}) {
    if (opts.inline_message_id || !this.svoy(opts.chat_id)) {
      this.vChuzhieChaty += 1;
      return real().editMessageText(text, opts);
    }
    const m = razgovor(this.chatId).messages.get(Number(opts.message_id));
    if (!m) throw telegramError("message to edit not found");
    m.text = String(text);
    m.parse_mode = opts.parse_mode || null;
    if ("reply_markup" in opts) m.reply_markup = opts.reply_markup || null;
    this.izmeneny.add(m.message_id);
    return { ...m };
  }

  async editMessageReplyMarkup(replyMarkup, opts = {}) {
    if (opts.inline_message_id || !this.svoy(opts.chat_id)) {
      this.vChuzhieChaty += 1;
      return real().editMessageReplyMarkup(replyMarkup, opts);
    }
    const m = razgovor(this.chatId).messages.get(Number(opts.message_id));
    if (!m) throw telegramError("message to edit not found");
    m.reply_markup = replyMarkup || null;
    this.izmeneny.add(m.message_id);
    return { ...m };
  }

  async deleteMessage(chatId, messageId) {
    if (!this.svoy(chatId)) {
      this.vChuzhieChaty += 1;
      return real().deleteMessage(chatId, messageId);
    }
    const id = Number(messageId);
    if (!razgovor(this.chatId).messages.delete(id)) throw telegramError("message to delete not found");
    this.izmeneny.delete(id);
    this.udaleny.add(id);
    return true;
  }

  /** Нажатия из CRM приходят с id «crm:…» (буква В) — их всплывающий ответ уходит в CRM */
  async answerCallbackQuery(callbackQueryId, opts = {}) {
    if (!String(callbackQueryId).startsWith("crm:")) return real().answerCallbackQuery(callbackQueryId, opts);
    if (opts.text) this.toasts.push(String(opts.text));
    return true;
  }

  async getMe() {
    return real().getMe();
  }

  /** Что этот запрос изменил в разговоре — ответ CRM */
  otvet() {
    const messages = razgovor(this.chatId).messages;
    return {
      messages: [...this.izmeneny]
        .filter((id) => messages.has(id))
        .sort((a, b) => a - b)
        .map((id) => {
          const m = messages.get(id);
          return {
            id,
            text: m.text,
            parseMode: m.parse_mode,
            replyTo: m.reply_to_message_id,
            buttons: (m.reply_markup?.inline_keyboard || []).map((ryad) =>
              ryad.map((k) => ({ text: k.text, data: k.callback_data || null, url: k.url || null })),
            ),
          };
        }),
      deleted: [...this.udaleny],
      toasts: [...this.toasts],
    };
  }
}

module.exports = { CrmBot, crmChatIdFor, isCrmChat, CRM_CHAT_BASE, _sbrosRazgovorov: () => razgovory.clear() };
