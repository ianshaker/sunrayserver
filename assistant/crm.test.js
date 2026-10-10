// Нейробот в CRM — сообщение и адрес (PLANS/CRM/18-neyrobot-na-glavnoy, буква Б). Запуск:
//   NODE_OPTIONS=--max-old-space-size=1024 node --test assistant/crm.test.js
// База и Gemini не зовутся: реестр чатов, роутер и Telegram подменены до загрузки модулей.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:9";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "test";

const test = require("node:test");
const assert = require("node:assert/strict");

const chaty = require("../lib/telegramBotChats");
const router = require("./router");
const { setTelegramBot } = require("../tgwebhook/bot");
const { registerIntent } = require("./registry");
const { REPLIES } = require("./config");

const YAN = "8f1c0d3e-0000-4000-8000-0000000000aa";
const BEZ_PRAV = "8f1c0d3e-0000-4000-8000-0000000000bb";
const LICHNYE = {
  [YAN]: { chatId: 111, title: "Ян Миронов", kind: "manager_personal", profileId: YAN, permissions: ["task_create", "master_schedule"] },
  [BEZ_PRAV]: { chatId: 222, title: "Гена", kind: "manager_personal", profileId: BEZ_PRAV, permissions: [] },
};
chaty.getPersonalChatByProfile = async (id) => LICHNYE[id] ?? null;

let sleduyushchiyOtvetRoutera = null;
router.classifyIntent = async () => sleduyushchiyOtvetRoutera;

const tgVyzovy = [];
setTelegramBot({
  sendMessage: async (...a) => { tgVyzovy.push(a); return { message_id: 1 }; },
  editMessageText: async (...a) => { tgVyzovy.push(a); return true; },
});

const videlUmenie = [];
registerIntent({
  name: "task_create",
  permission: "task_create",
  description: "подставное создание задачи",
  handle: async (ctx) => {
    videlUmenie.push({ chatId: ctx.chatId, chatTitle: ctx.chat.title, profileId: ctx.profileId, text: ctx.text, istochnik: ctx.istochnik });
    if (ctx.text === "упади") throw new Error("умение упало");
    await ctx.statusMsg.finalize("Создать задачу?\n---\nПозвонить клиенту", {
      inline_keyboard: [[{ text: "Сохранить", callback_data: "tc:save:x1" }, { text: "Отменить", callback_data: "tc:cancel:x1" }]],
    });
  },
});
registerIntent({
  name: "master_schedule_query",
  permission: "master_schedule",
  description: "подставной график",
  handle: async (ctx) => {
    await ctx.statusMsg.update("Гена завтра: 10:00 замер, Истра", 0);
    await ctx.bot.sendMessage(-1001234567890, "копия в чат мастеров");
  },
});

const { soobshchenieIzCrm, NET_LICHNOGO_CHATA, NET_PRAV } = require("./crm");
const { crmChatIdFor } = require("./crmBot");

const ponyal = (intent) => ({ intent, confidence: 0.95, reason: "тест" });

test("нет личного чата — ответ словами, умения не зовутся", async () => {
  const o = await soobshchenieIzCrm({ profileId: "нет-такого", text: "дай дедлайны" });
  assert.deepEqual(o.messages.map((m) => m.text), [NET_LICHNOGO_CHATA]);
});

test("личный чат без прав — ответ словами", async () => {
  const o = await soobshchenieIzCrm({ profileId: BEZ_PRAV, text: "поставь задачу" });
  assert.deepEqual(o.messages.map((m) => m.text), [NET_PRAV]);
});

test("задача: тот же путь, что в Telegram — превью с кнопками в чат CRM, Telegram молчит", async () => {
  tgVyzovy.length = 0;
  videlUmenie.length = 0;
  sleduyushchiyOtvetRoutera = ponyal("task_create");
  const o = await soobshchenieIzCrm({ profileId: YAN, text: "напомни завтра в 10 позвонить" });
  assert.equal(o.messages.length, 1, "статус превратился в превью — одно сообщение");
  assert.equal(o.messages[0].text, "Создать задачу?\n---\nПозвонить клиенту");
  assert.equal(o.messages[0].buttons[0][0].data, "tc:save:x1");
  assert.equal(tgVyzovy.length, 0);
  assert.deepEqual(videlUmenie[0], {
    chatId: crmChatIdFor(YAN), chatTitle: "CRM · Ян Миронов", profileId: YAN, text: "напомни завтра в 10 позвонить", istochnik: "crm",
  });
});

test("умение шлёт в чужой чат — туда уходит настоящий Telegram, в CRM — ответ", async () => {
  tgVyzovy.length = 0;
  sleduyushchiyOtvetRoutera = ponyal("master_schedule_query");
  const o = await soobshchenieIzCrm({ profileId: YAN, text: "что у Гены завтра" });
  assert.deepEqual(o.messages.map((m) => m.text), ["Гена завтра: 10:00 замер, Истра"]);
  assert.equal(o.vChuzhieChaty, 1);
  assert.equal(tgVyzovy[0][0], -1001234567890);
});

test("не понял — тот же текст, что в Telegram; умение упало — «не удалось», не тишина", async () => {
  sleduyushchiyOtvetRoutera = { intent: "unknown", confidence: 0.1, reason: "тест" };
  let o = await soobshchenieIzCrm({ profileId: YAN, text: "бла-бла" });
  assert.deepEqual(o.messages.map((m) => m.text), [REPLIES.UNKNOWN]);
  sleduyushchiyOtvetRoutera = ponyal("task_create");
  o = await soobshchenieIzCrm({ profileId: YAN, text: "упади" });
  assert.deepEqual(o.messages.map((m) => m.text), [REPLIES.ERROR]);
});

test("задача из CRM не привязывает «отбивку» к ненастоящему чату", async () => {
  const { supabase } = require("../tasks/supabaseClient");
  const prezhniy = supabase.from;
  const zvali = [];
  supabase.from = (...a) => { zvali.push(a); return prezhniy.apply(supabase, a); };
  try {
    const { attachTelegramOrigin } = require("../tasks/create/createTask");
    await attachTelegramOrigin("task-1", crmChatIdFor(YAN), 5);
    assert.equal(zvali.length, 0, "в manager_tasks не ходили");
  } finally {
    supabase.from = prezhniy;
  }
});

test("адрес: без пропуска — 401, пустой текст — 400, ответ — сообщения без служебного счётчика", async () => {
  const Fastify = require("fastify");
  const { registerNeurobotRoutes, MESSAGE_PATH } = require("./crmRoutes");
  const app = Fastify();
  registerNeurobotRoutes(app, {
    proveritPolzovatelya: async (req, reply) => {
      if (req.headers.authorization !== "Bearer ok") { reply.code(401).send({ error: "unauthorized" }); return null; }
      return { id: YAN, email: "yan@test" };
    },
  });
  let r = await app.inject({ method: "POST", url: MESSAGE_PATH, payload: { text: "привет" } });
  assert.equal(r.statusCode, 401);
  r = await app.inject({ method: "POST", url: MESSAGE_PATH, headers: { authorization: "Bearer ok" }, payload: { text: "   " } });
  assert.equal(r.statusCode, 400);
  sleduyushchiyOtvetRoutera = ponyal("task_create");
  r = await app.inject({ method: "POST", url: MESSAGE_PATH, headers: { authorization: "Bearer ok" }, payload: { text: "напомни позвонить" } });
  assert.equal(r.statusCode, 200);
  const telo = r.json();
  assert.equal(telo.status, "ok");
  assert.equal(telo.messages[0].buttons[0][1].text, "Отменить");
  assert.equal("vChuzhieChaty" in telo, false);
  await app.close();
});
