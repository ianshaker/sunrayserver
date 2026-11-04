// Маршруты отправки карточек мастерам читают чат из общего списка (с запасом и из «базы»).
// Запуск: node --test lib/mastersRoutes.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");

const dir = require("./mastersDirectory");
const { registerZamerRoute } = require("../info-na-zamer/route");
const { registerMasterScheduleRoute } = require("../master-schedule/route");
const { MASTER_CHAT_IDS, LOADING_CHAT_ID } = require("../info-na-zamer/config");

function buildApp() {
  const sent = [];
  const bot = {
    async sendMessage(chatId, text) {
      sent.push({ chatId, text });
      return { message_id: sent.length };
    },
  };
  const app = Fastify();
  registerZamerRoute(app, bot);
  registerMasterScheduleRoute(app);
  return { app, sent };
}

async function post(app, url, payload) {
  const res = await app.inject({ method: "POST", url, payload });
  return { code: res.statusCode, body: res.json() };
}

const base = { appealNumber: "#1", clientName: "Тест", phone: "+70000000000", city: "Москва", address: "ул. Тестовая, 1", date: "2026-11-05", startTime: "10:00", endTime: "11:00", eventType: "Замер" };

test("новая заявка: карточка уходит в чат мастера из запаса, имя с «ё» и без — один чат", async () => {
  dir._setForTests();
  const { app, sent } = buildApp();
  for (const masterName of ["СЕМЕН", "Семён", "семен"]) {
    const r = await post(app, "/events/zamer", { ...base, masterName });
    assert.equal(r.code, 200, masterName);
    assert.equal(r.body.chatId, MASTER_CHAT_IDS["СЕМЕН"], masterName);
  }
  assert.equal(sent.length, 3);
  assert.ok(sent.every((m) => m.chatId === MASTER_CHAT_IDS["СЕМЕН"]));
});

test("все 11 мастеров с чатами достижимы под именем, как их шлёт CRM (верхний регистр)", async () => {
  dir._setForTests();
  const { app } = buildApp();
  for (const [tg, id] of Object.entries(MASTER_CHAT_IDS)) {
    const r = await post(app, "/events/zamer", { ...base, masterName: tg });
    assert.equal(r.code, 200, tg);
    assert.equal(r.body.chatId, id, tg);
  }
});

test("Вячеслав без чата и неизвестное имя: 400 как раньше, ничего не отправлено", async () => {
  dir._setForTests();
  const { app, sent } = buildApp();
  for (const masterName of ["ВЯЧЕСЛАВ", "ЗИНАИДА"]) {
    const r = await post(app, "/events/zamer", { ...base, masterName });
    assert.equal(r.code, 400, masterName);
    assert.equal(r.body.sent, false);
    assert.match(r.body.error, /не найден/);
  }
  assert.equal(sent.length, 0);
});

test("погрузка и пустой мастер уходят в чат «Погрузка»", async () => {
  dir._setForTests();
  const { app } = buildApp();
  const r1 = await post(app, "/events/zamer", { ...base, masterName: "" });
  assert.equal(r1.body.chatId, LOADING_CHAT_ID);
  const r2 = await post(app, "/events/zamer", { ...base, masterName: "Погрузка" });
  assert.equal(r2.body.chatId, LOADING_CHAT_ID);
});

test("обновление, отмена и переназначение: чаты берутся из списка", async () => {
  dir._setForTests();
  const { app, sent } = buildApp();
  const upd = await post(app, "/events/zamer", { ...base, masterName: "РОМА", updateType: "updated" });
  assert.equal(upd.body.chatId, MASTER_CHAT_IDS["РОМА"]);
  const can = await post(app, "/events/zamer", { ...base, masterName: "ТИМУР", updateType: "cancelled" });
  assert.equal(can.body.chatId, MASTER_CHAT_IDS["ТИМУР"]);
  const re = await post(app, "/events/zamer", { ...base, masterName: "ЛЕША", oldMaster: "АНТОН", updateType: "reassigned" });
  assert.equal(re.body.chatId, MASTER_CHAT_IDS["ЛЕША"]);
  assert.ok(re.body.cancelMessageId);
  assert.deepEqual(sent.map((m) => m.chatId).slice(-2), [MASTER_CHAT_IDS["АНТОН"], MASTER_CHAT_IDS["ЛЕША"]]);
});

test("новый мастер из базы получает карточки без перезапуска сервера", async () => {
  const denis = { key: "denis", name: "Денис", is_active: true, tg_chat_id: -1009990000001, tg_key: "ДЕНИС", sort_order: 13 };
  const rows = dir.FALLBACK_MASTERS.map((m, i) => ({ key: m.key, name: m.name, is_active: true, tg_chat_id: m.chatId, tg_key: m.tgKey, sort_order: i + 1 }));
  let withDenis = false;
  dir._setForTests({ refresh: true, loader: async () => ({ data: withDenis ? [...rows, denis] : rows, error: null }) });
  await dir.refresh();
  const { app } = buildApp();
  const before = await post(app, "/events/zamer", { ...base, masterName: "ДЕНИС" });
  assert.equal(before.code, 400);
  withDenis = true;
  // ждём окно между перечитками (10 с) искусственно: сдвигаем время последней попытки
  dir._setForTests({ refresh: true, loader: async () => ({ data: [...rows, denis], error: null }) });
  const after = await post(app, "/events/zamer", { ...base, masterName: "ДЕНИС" });
  assert.equal(after.code, 200);
  assert.equal(after.body.chatId, denis.tg_chat_id);
});

test("график мастера: неизвестный мастер — 400, без отправки", async () => {
  dir._setForTests();
  const { app } = buildApp();
  const r = await post(app, "/events/master-schedule", { masterName: "ЗИНАИДА", imageBase64: "x" });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /не найден/);
  const r2 = await post(app, "/events/master-schedule", {});
  assert.equal(r2.code, 400);
});
