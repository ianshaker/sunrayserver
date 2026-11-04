// POST /masters/check-chat: проверка чата мастера из CRM (только суперадмин).
// Бот и supabase — двойники: настоящий Telegram и настоящая база не вызываются.
// Запуск: node --test lib/mastersAdmin.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");

// --- Двойник supabase: токен → пользователь, пользователь → роль в profiles ---
const USERS = {
  "tok-super": { id: "u-super", email: "super@test" },
  "tok-super2": { id: "u-super2", email: "super2@test" },
  "tok-admin": { id: "u-admin", email: "admin@test" },
  "tok-noprofile": { id: "u-noprofile", email: "np@test" },
};
const ROLES = { "u-super": "superadmin", "u-super2": "superadmin", "u-admin": "admin" };

const fakeSupabase = {
  auth: {
    async getUser(token) {
      const user = USERS[token];
      return user ? { data: { user: { ...user } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } };
    },
  },
  from(table) {
    assert.equal(table, "profiles");
    let id = null;
    const q = {
      select: () => q,
      eq: (_col, val) => ((id = val), q),
      maybeSingle: async () => ({ data: ROLES[id] ? { id, role: ROLES[id] } : null, error: null }),
    };
    return q;
  },
};

const clientPath = require.resolve("./supabaseClient");
require.cache[clientPath] = {
  id: clientPath,
  filename: clientPath,
  loaded: true,
  exports: { supabase: fakeSupabase, supabaseAnon: {}, logSupabaseBoot() {} },
};

const { setTelegramBot } = require("../tgwebhook/bot");
const { registerMastersAdminRoutes, CHECK_TEXT } = require("./mastersAdmin");

const CHAT = -1001234567890;
const OK_MESSAGE = "Проверка связи SUNRAY: чат подключён к мастеру. Это сообщение можно удалить.";

/** Ошибка в том виде, в каком её бросает node-telegram-bot-api. */
function tgError(description, code = 400, extra = {}) {
  const e = new Error(`ETELEGRAM: ${code} ${description}`);
  e.code = "ETELEGRAM";
  e.response = { statusCode: code, body: { ok: false, error_code: code, description, ...extra } };
  return e;
}

/** Двойник бота: журнал вызовов + заданные ответы/ошибки. */
function makeBot({ chat = { id: CHAT, title: "Мастер Семён", type: "supergroup" }, getChatError = null, sendError = null } = {}) {
  const calls = [];
  return {
    calls,
    async getChat(id) {
      calls.push(["getChat", id]);
      if (getChatError) throw getChatError;
      return chat;
    },
    async sendMessage(id, text) {
      calls.push(["sendMessage", id, text]);
      if (sendError) throw sendError;
      return { message_id: 1 };
    },
  };
}

/** Приложение + часы, которыми управляет тест. */
function build({ bot = makeBot() } = {}) {
  setTelegramBot(bot);
  const clock = { t: 1_000_000 };
  const app = Fastify();
  registerMastersAdminRoutes(app, { now: () => clock.t });
  return { app, bot, clock };
}

async function check(app, payload, token = "tok-super") {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await app.inject({ method: "POST", url: "/masters/check-chat", headers, payload });
  return { code: res.statusCode, body: res.json() };
}

const sent = (bot) => bot.calls.filter((c) => c[0] === "sendMessage");

test("текст проверки — ровно как в задании", () => {
  assert.equal(CHECK_TEXT, OK_MESSAGE);
});

// ---------- доступ ----------

test("без Authorization: 401, бот не вызывался", async () => {
  const { app, bot } = build();
  const r = await check(app, { chat_id: CHAT }, null);
  assert.equal(r.code, 401);
  assert.equal(bot.calls.length, 0);
});

test("токен не распознан: 401, бот не вызывался", async () => {
  const { app, bot } = build();
  const r = await check(app, { chat_id: CHAT }, "tok-плохой");
  assert.equal(r.code, 401);
  assert.equal(bot.calls.length, 0);
});

test("нет профиля: 401, бот не вызывался", async () => {
  const { app, bot } = build();
  const r = await check(app, { chat_id: CHAT }, "tok-noprofile");
  assert.equal(r.code, 401);
  assert.equal(bot.calls.length, 0);
});

test("не суперадмин (роль admin): 403, ни getChat, ни sendMessage", async () => {
  const { app, bot } = build();
  const r = await check(app, { chat_id: CHAT }, "tok-admin");
  assert.equal(r.code, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(bot.calls.length, 0);
  assert.equal(sent(bot).length, 0);
});

test("отказ в доступе не тратит окно: суперадмин после него проходит сразу", async () => {
  const { app, bot } = build();
  await check(app, { chat_id: CHAT }, "tok-admin");
  const r = await check(app, { chat_id: CHAT });
  assert.equal(r.code, 200);
  assert.equal(sent(bot).length, 1);
});

// ---------- проверка chat_id ----------

test("плохой chat_id: 400 с текстом из задания, бот не вызывался", async () => {
  const bad = [undefined, null, "", "  ", "abc", "12abc", "1.5", "1e3", "0x10", 0, "0", "-0", 1.5, NaN, Infinity, 2 ** 60, true, {}, [], [CHAT]];
  for (const chat_id of bad) {
    const { app, bot } = build();
    const r = await check(app, chat_id === undefined ? {} : { chat_id });
    assert.equal(r.code, 400, JSON.stringify(chat_id));
    assert.deepEqual(r.body, { ok: false, error: "Номер чата — целое число, не ноль" }, JSON.stringify(chat_id));
    assert.equal(bot.calls.length, 0, JSON.stringify(chat_id));
  }
});

test("тела нет вовсе: 400", async () => {
  const { app, bot } = build();
  const r = await check(app, undefined);
  assert.equal(r.code, 400);
  assert.equal(bot.calls.length, 0);
});

test("плохой chat_id не тратит окно в 5 секунд", async () => {
  const { app, bot } = build();
  assert.equal((await check(app, { chat_id: "abc" })).code, 400);
  assert.equal((await check(app, { chat_id: CHAT })).code, 200);
  assert.equal(sent(bot).length, 1);
});

// ---------- успех ----------

test("успех: getChat и sendMessage по разу, с нужными аргументами, ответ с title и type", async () => {
  const { app, bot } = build();
  const r = await check(app, { chat_id: CHAT });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { ok: true, title: "Мастер Семён", type: "supergroup" });
  assert.deepEqual(bot.calls, [
    ["getChat", CHAT],
    ["sendMessage", CHAT, OK_MESSAGE],
  ]);
});

test("успех: chat_id строкой и положительное число — бот получает число", async () => {
  for (const [chat_id, expected] of [["-1001234567890", -1001234567890], [" -4012345 ", -4012345], [987654321, 987654321]]) {
    const { app, bot } = build();
    const r = await check(app, { chat_id });
    assert.equal(r.code, 200, String(chat_id));
    assert.deepEqual(bot.calls, [
      ["getChat", expected],
      ["sendMessage", expected, OK_MESSAGE],
    ]);
  }
});

test("успех: у чата нет title — вернётся null, не падает", async () => {
  const { app } = build({ bot: makeBot({ chat: { id: 5, type: "private" } }) });
  const r = await check(app, { chat_id: 5 });
  assert.deepEqual(r.body, { ok: true, title: null, type: "private" });
});

// ---------- ошибки Telegram: 200 и {ok:false, error по-русски} ----------

const NOT_FOUND = "Чат не найден: проверьте номер (у групп он начинается с -100)";
const NO_ACCESS = "Бота нет в этом чате или ему нельзя писать: добавьте @SUNRAYY_bot в чат";
const UPGRADED = "Группа стала супергруппой: возьмите новый номер чата";
const WAIT = "Telegram просит подождать: повторите через минуту";

const MAPPING = [
  ["chat not found (getChat)", { getChatError: tgError("Bad Request: chat not found") }, NOT_FOUND],
  ["chat not found (sendMessage)", { sendError: tgError("Bad Request: chat not found") }, NOT_FOUND],
  ["bot was kicked", { sendError: tgError("Forbidden: bot was kicked from the supergroup chat", 403) }, NO_ACCESS],
  ["bot is not a member", { getChatError: tgError("Forbidden: bot is not a member of the channel chat", 403) }, NO_ACCESS],
  ["not enough rights", { sendError: tgError("Bad Request: not enough rights to send text messages to the chat") }, NO_ACCESS],
  ["have no rights to send", { sendError: tgError("Bad Request: have no rights to send a message") }, NO_ACCESS],
  ["Forbidden (бот заблокирован)", { sendError: tgError("Forbidden: bot was blocked by the user", 403) }, NO_ACCESS],
  ["Forbidden без описания, только код 403", { sendError: tgError("", 403) }, NO_ACCESS],
  [
    "группа стала супергруппой",
    { sendError: tgError("Bad Request: group chat was upgraded to a supergroup chat", 400, { parameters: { migrate_to_chat_id: -1009 } }) },
    UPGRADED,
  ],
  ["Too Many Requests", { sendError: tgError("Too Many Requests: retry after 30", 429, { parameters: { retry_after: 30 } }) }, WAIT],
  ["только код 429", { sendError: tgError("что-то странное", 429) }, WAIT],
  ["ошибка без ответа Telegram, только message", { sendError: new Error("Too Many Requests: retry after 5") }, WAIT],
];

for (const [name, opts, expected] of MAPPING) {
  test(`ошибка Telegram «${name}»: 200 и русский текст`, async () => {
    const { app, bot } = build({ bot: makeBot(opts) });
    const r = await check(app, { chat_id: CHAT });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body, { ok: false, error: expected });
    // ошибка в getChat — до sendMessage дело не доходит
    if (opts.getChatError) assert.equal(sent(bot).length, 0);
  });
}

test("прочая ошибка: «Telegram не принял сообщение: » и первые 120 знаков", async () => {
  const short = "Bad Request: message is too long";
  const a = build({ bot: makeBot({ sendError: tgError(short) }) });
  assert.deepEqual((await check(a.app, { chat_id: CHAT })).body, { ok: false, error: `Telegram не принял сообщение: ${short}` });

  const long = "Bad Request: " + "я".repeat(200);
  const b = build({ bot: makeBot({ sendError: tgError(long) }) });
  const r = await check(b.app, { chat_id: CHAT });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.error, `Telegram не принял сообщение: ${long.slice(0, 120)}`);
  assert.equal(r.body.error.length, "Telegram не принял сообщение: ".length + 120);
});

test("прочая ошибка без ответа Telegram (сеть): берётся message, токен бота вырезается", async () => {
  const net = new Error("EFATAL: request to https://api.telegram.org/bot123456789:AAAbbbCCCdddEEEfffGGGhhhIIIjjjKKK12/getChat failed");
  const { app } = build({ bot: makeBot({ getChatError: net }) });
  const r = await check(app, { chat_id: CHAT });
  assert.equal(r.code, 200);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /^Telegram не принял сообщение: EFATAL/);
  assert.doesNotMatch(r.body.error, /AAAbbb|123456789/);
});

// ---------- защита от частых нажатий ----------

test("повтор раньше 5 секунд: 429, бот второй раз не вызывался; ровно через 5 с — снова можно", async () => {
  const { app, bot, clock } = build();
  assert.equal((await check(app, { chat_id: CHAT })).code, 200);
  assert.equal(sent(bot).length, 1);

  const again = await check(app, { chat_id: CHAT });
  assert.equal(again.code, 429);
  assert.deepEqual(again.body, { ok: false, error: "Подождите несколько секунд" });
  assert.equal(bot.calls.length, 2, "ни getChat, ни sendMessage при 429");

  clock.t += 4999;
  assert.equal((await check(app, { chat_id: CHAT })).code, 429);

  clock.t += 1;
  assert.equal((await check(app, { chat_id: CHAT })).code, 200);
  assert.equal(sent(bot).length, 2);
});

test("окно считается на пользователя: другой суперадмин не ждёт", async () => {
  const { app, bot } = build();
  assert.equal((await check(app, { chat_id: CHAT }, "tok-super")).code, 200);
  assert.equal((await check(app, { chat_id: CHAT }, "tok-super2")).code, 200);
  assert.equal((await check(app, { chat_id: CHAT }, "tok-super")).code, 429);
  assert.equal(sent(bot).length, 2);
});

test("после ошибки Telegram окно тоже действует: нет шторма повторов", async () => {
  const { app, bot } = build({ bot: makeBot({ sendError: tgError("Bad Request: chat not found") }) });
  assert.equal((await check(app, { chat_id: CHAT })).code, 200);
  assert.equal((await check(app, { chat_id: CHAT })).code, 429);
  assert.equal(sent(bot).length, 1);
});

// ---------- бот не запущен ----------

test("бота нет (сервер ещё не поднял): 503, окно не тратится", async () => {
  setTelegramBot(null);
  const clock = { t: 5 };
  const app = Fastify();
  registerMastersAdminRoutes(app, { now: () => clock.t });
  const r = await check(app, { chat_id: CHAT });
  assert.equal(r.code, 503);
  assert.deepEqual(r.body, { ok: false, error: "Бот Telegram сейчас не запущен" });

  const bot = makeBot();
  setTelegramBot(bot);
  assert.equal((await check(app, { chat_id: CHAT })).code, 200);
  assert.equal(sent(bot).length, 1);
});

test.after(() => setTelegramBot(null));
