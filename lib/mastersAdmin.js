// Экран «Мастера» в CRM: проверка чата мастера (только суперадмин).
// POST /masters/check-chat {chat_id} → бот читает чат (getChat) и пишет в него одну проверочную строку.
// Доступ — как у POST /telegram/bot-chats/reload-cache: Bearer JWT + роль superadmin.

const { assertSuperAdminFromRequest } = require("./telegramBotChatsAdmin");
const { getRealTelegramBot } = require("../tgwebhook/bot");

const CHECK_TEXT = "Проверка связи SUNRAY: чат подключён к мастеру. Это сообщение можно удалить.";
const MIN_INTERVAL_MS = 5000;
const ERROR_TEXT_LIMIT = 120;

const MSG = {
  badChatId: "Номер чата — целое число, не ноль",
  tooOften: "Подождите несколько секунд",
  noBot: "Бот Telegram сейчас не запущен",
  notFound: "Чат не найден: проверьте номер (у групп он начинается с -100)",
  noAccess: "Бота нет в этом чате или ему нельзя писать: добавьте @SUNRAYY_bot в чат",
  upgraded: "Группа стала супергруппой: возьмите новый номер чата",
  rateLimited: "Telegram просит подождать: повторите через минуту",
};

/** chat_id: целое число (или строка из цифр с минусом), не ноль. Иначе null. */
function parseChatId(raw) {
  let n;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) n = Number(raw.trim());
  else return null;
  return Number.isSafeInteger(n) && n !== 0 ? n : null;
}

/** Текст ошибки Telegram (node-telegram-bot-api кладёт ответ в error.response.body). */
function telegramErrorText(error) {
  const body = error?.response?.body;
  const text = body?.description || error?.message || String(error ?? "");
  // токен бота в текст ошибки не пускаем
  return String(text).replace(/\bbot\d+:[\w-]+/gi, "bot***").replace(/\d{6,}:[\w-]{30,}/g, "***");
}

function telegramErrorCode(error) {
  const code = error?.response?.body?.error_code ?? error?.response?.statusCode;
  return Number(code) || null;
}

/** Ошибка Telegram → понятная фраза по-русски. */
function explainTelegramError(error) {
  const text = telegramErrorText(error);
  const low = text.toLowerCase();
  const code = telegramErrorCode(error);

  if (low.includes("group chat was upgraded to a supergroup")) return MSG.upgraded;
  if (low.includes("too many requests") || code === 429) return MSG.rateLimited;
  if (low.includes("chat not found")) return MSG.notFound;
  if (
    low.includes("bot was kicked") ||
    low.includes("bot is not a member") ||
    low.includes("not enough rights") ||
    low.includes("have no rights to send") ||
    low.includes("forbidden") ||
    code === 403
  ) {
    return MSG.noAccess;
  }
  return `Telegram не принял сообщение: ${text.slice(0, ERROR_TEXT_LIMIT)}`;
}

/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {{ now?: () => number }} [opts] now — часы для тестов
 */
function registerMastersAdminRoutes(fastify, opts = {}) {
  const now = opts.now || Date.now;
  /** user.id → время последней проверки (мс); на пользователя, в памяти процесса */
  const lastCheckAt = new Map();

  fastify.post("/masters/check-chat", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const chatId = parseChatId(request.body?.chat_id);
    if (chatId === null) {
      return reply.code(400).send({ ok: false, error: MSG.badChatId });
    }

    const bot = getRealTelegramBot();
    if (!bot) {
      return reply.code(503).send({ ok: false, error: MSG.noBot });
    }

    // не чаще раза в 5 секунд на пользователя; метку ставим до обращения к Telegram
    const t = now();
    for (const [id, at] of lastCheckAt) if (t - at >= MIN_INTERVAL_MS) lastCheckAt.delete(id);
    if (lastCheckAt.has(user.id)) {
      return reply.code(429).send({ ok: false, error: MSG.tooOften });
    }
    lastCheckAt.set(user.id, t);

    try {
      const chat = await bot.getChat(chatId);
      await bot.sendMessage(chatId, CHECK_TEXT);
      console.log(`[masters] check-chat ${chatId}: ок (${user.email || user.id})`);
      return reply.send({ ok: true, title: chat?.title ?? null, type: chat?.type ?? null });
    } catch (error) {
      console.warn(
        `[masters] check-chat ${chatId}: ${telegramErrorText(error).slice(0, ERROR_TEXT_LIMIT)} (${user.email || user.id})`,
      );
      return reply.send({ ok: false, error: explainTelegramError(error) });
    }
  });
}

module.exports = { registerMastersAdminRoutes, parseChatId, explainTelegramError, CHECK_TEXT };
