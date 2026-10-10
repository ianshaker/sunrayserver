// «Бот CRM» (PLANS/CRM/18-neyrobot-na-glavnoy, буква А). Запуск:
//   NODE_OPTIONS=--max-old-space-size=1024 node --test assistant/crmBot.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { setTelegramBot, getTelegramBot, runWithBot } = require("../tgwebhook/bot");
const { CrmBot, crmChatIdFor, isCrmChat, _sbrosRazgovorov } = require("./crmBot");
const { StatusMessage } = require("./statusMessage");

/** Подставной настоящий бот: помнит, что ему слали */
function podstavnoyTelegram() {
  const vyzovy = [];
  const zapisat = (imya) => async (...args) => {
    vyzovy.push({ imya, args });
    return { message_id: 777, chat: { id: args[0] } };
  };
  return {
    vyzovy,
    sendMessage: zapisat("sendMessage"),
    editMessageText: zapisat("editMessageText"),
    deleteMessage: zapisat("deleteMessage"),
    answerCallbackQuery: zapisat("answerCallbackQuery"),
    getMe: async () => ({ id: 1, username: "SUNRAYY_bot" }),
  };
}

const PROFIL = "8f1c0d3e-0000-4000-8000-000000000001";

test("подмена: внутри runWithBot — бот CRM, вне и после — настоящий", async () => {
  const tg = podstavnoyTelegram();
  setTelegramBot(tg);
  const crm = new CrmBot(crmChatIdFor(PROFIL));
  assert.equal(getTelegramBot(), tg);
  await runWithBot(crm, async () => {
    assert.equal(getTelegramBot(), crm);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(getTelegramBot(), crm, "после await внутри запроса — всё ещё бот CRM");
  });
  assert.equal(getTelegramBot(), tg);
});

test("свой чат: статус «Думаю…» → превью с кнопками копится, Telegram не зовётся", async () => {
  _sbrosRazgovorov();
  const tg = podstavnoyTelegram();
  setTelegramBot(tg);
  const chatId = crmChatIdFor(PROFIL);
  const crm = new CrmBot(chatId);
  await runWithBot(crm, async () => {
    const status = new StatusMessage(getTelegramBot(), chatId, null);
    await status.send("⏳ Вижу меня отметили, изучаю запрос...");
    await status.update("💭 Думаю над запросом...", 0);
    await status.finalize("Создать задачу?\n---\nПозвонить клиенту", {
      inline_keyboard: [[{ text: "Сохранить", callback_data: "tc:save:abc" }, { text: "Отменить", callback_data: "tc:cancel:abc" }]],
    });
  });
  const o = crm.otvet();
  assert.equal(o.messages.length, 1);
  assert.equal(o.messages[0].text, "Создать задачу?\n---\nПозвонить клиенту");
  assert.deepEqual(o.messages[0].buttons, [[
    { text: "Сохранить", data: "tc:save:abc", url: null },
    { text: "Отменить", data: "tc:cancel:abc", url: null },
  ]]);
  assert.equal(tg.vyzovy.length, 0, "в Telegram ничего не ушло");
});

test("чужой чат (погрузка, мастер) — настоящим Telegram, как из Telegram", async () => {
  const tg = podstavnoyTelegram();
  setTelegramBot(tg);
  const crm = new CrmBot(crmChatIdFor(PROFIL));
  await runWithBot(crm, () => getTelegramBot().sendMessage(-1001234567890, "Заявка #08044 — в погрузку"));
  assert.equal(tg.vyzovy.length, 1);
  assert.equal(tg.vyzovy[0].args[0], -1001234567890);
  assert.equal(crm.vChuzhieChaty, 1);
  assert.equal(crm.otvet().messages.length, 0);
});

test("разговор живёт между запросами: кнопка правит превью прошлого запроса, удаление — в ответе", async () => {
  _sbrosRazgovorov();
  setTelegramBot(podstavnoyTelegram());
  const chatId = crmChatIdFor(PROFIL);
  const pervyy = new CrmBot(chatId);
  const { message_id: id } = await pervyy.sendMessage(chatId, "Создать задачу?");
  const vtoroy = new CrmBot(chatId);
  await vtoroy.editMessageText("✅ Создал задачу #17", { chat_id: chatId, message_id: id });
  assert.deepEqual(vtoroy.otvet().messages.map((m) => [m.id, m.text]), [[id, "✅ Создал задачу #17"]]);
  await vtoroy.deleteMessage(chatId, id);
  assert.deepEqual(vtoroy.otvet().deleted, [id]);
  await assert.rejects(vtoroy.editMessageText("x", { chat_id: chatId, message_id: id }), /message to edit not found/);
});

test("всплывающий ответ на кнопку из CRM — в ответ, на кнопку Telegram — в Telegram", async () => {
  const tg = podstavnoyTelegram();
  setTelegramBot(tg);
  const crm = new CrmBot(crmChatIdFor(PROFIL));
  await crm.answerCallbackQuery("crm:1", { text: "Черновик устарел" });
  await crm.answerCallbackQuery("4242", { text: "из Telegram" });
  assert.deepEqual(crm.otvet().toasts, ["Черновик устарел"]);
  assert.equal(tg.vyzovy.length, 1);
});

test("чат CRM не путается с чатами Telegram", () => {
  const a = crmChatIdFor(PROFIL);
  assert.equal(a, crmChatIdFor(PROFIL), "у человека один и тот же чат");
  assert.notEqual(a, crmChatIdFor("другой-профиль"));
  assert.ok(isCrmChat(a));
  for (const tgChat of [12345678, -4567890123, -1001234567890, -1009999999999]) assert.equal(isCrmChat(tgChat), false);
  assert.throws(() => new CrmBot(-1001234567890), /не чат CRM/);
});
