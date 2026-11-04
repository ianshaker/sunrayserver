// Тесты общего списка мастеров сервера: запас, чтение из базы, сбои, имена с «ё».
// Запуск: node --test lib/mastersDirectory.test.js
const test = require("node:test");
const assert = require("node:assert/strict");

const dir = require("./mastersDirectory");
const { resolveAssignableMaster, isAssignableMaster, getTelegramMasterKey } = require("../loading-deadlines/masters");
const { getFuelTableKey } = require("../loading-deadlines/fuel");
const { resolveMasterName, canonicalMasters } = require("../schedule-ai/masterAliases");
const { MASTER_CHAT_IDS } = require("../info-na-zamer/config");

// Эталон «как было до таблицы masters»: ключи топлива и ключи Telegram, которые стояли в коде.
const OLD_FUEL = {
  Алексей: "aleksei", Антон: "anton", Евгений: "evgeniy", Леша: "lesha", Рома: "roma", Семён: "semen",
  Семен: "semen", Тимур: "timur", Владимир: "vladimir", Вячеслав: "vyacheslav", Дима: "dima",
  Даниил: "daniil", Углов: "yglov",
};
const OLD_TG = {
  Леша: "ЛЕША", Антон: "АНТОН", Семён: "СЕМЕН", Семен: "СЕМЕН", Рома: "РОМА", Тимур: "ТИМУР",
  Владимир: "ВЛАДИМИР", Евгений: "ЕВГЕНИЙ", Алексей: "АЛЕКСЕЙ", Дима: "ДИМА", Даниил: "ДАНИИЛ", Углов: "УГЛОВ",
};

function dbRows(extra = []) {
  const rows = dir.FALLBACK_MASTERS.map((m, i) => ({
    key: m.key, name: m.name, is_active: true, tg_chat_id: m.chatId, tg_key: m.tgKey, sort_order: i + 1,
  }));
  return [...rows, ...extra];
}
const DENIS = { key: "denis", name: "Денис", is_active: true, tg_chat_id: -1009990000001, tg_key: "ДЕНИС", sort_order: 13 };

test("запас: 12 мастеров и 11 чатов, как было зашито в коде", () => {
  dir._setForTests();
  assert.equal(dir.FALLBACK_MASTERS.length, 12);
  assert.equal(dir.FALLBACK_MASTERS.filter((m) => m.chatId != null).length, 11);
  assert.equal(dir.getSource(), "fallback");
  for (const [tg, id] of Object.entries(MASTER_CHAT_IDS)) {
    assert.equal(dir.findByTgKeyOrName(tg).chatId, id, tg);
  }
});

test("запас: ключи топлива и ключи Telegram совпадают со старыми словарями", () => {
  dir._setForTests();
  for (const [name, key] of Object.entries(OLD_FUEL)) assert.equal(getFuelTableKey(name), key, name);
  for (const [name, tg] of Object.entries(OLD_TG)) assert.equal(getTelegramMasterKey(name), tg, name);
  assert.equal(getFuelTableKey("Неизвестный"), null);
  assert.equal(getTelegramMasterKey("Вячеслав"), null);
});

test("«Семён», «семен», «СЕМЁН» и «СЕМЕН» — один мастер", () => {
  dir._setForTests();
  const ids = new Set(["Семён", "семен", "СЕМЁН", "СЕМЕН", " Семен "].map((n) => dir.findByTgKeyOrName(n)?.key));
  assert.deepEqual([...ids], ["semen"]);
});

test("чат мастера: Вячеслав без чата — null, остальные находятся", async () => {
  dir._setForTests();
  assert.equal(await dir.getChatId("СЕМЕН"), MASTER_CHAT_IDS["СЕМЕН"]);
  assert.equal(await dir.getChatId("ВЯЧЕСЛАВ"), null);
  assert.equal(await dir.getChatId("НЕИЗВЕСТНЫЙ"), null);
});

test("назначение через бота: как раньше — 11 имён, Вячеслав без чата отказ", () => {
  dir._setForTests();
  assert.equal(resolveAssignableMaster("Леша").ok, true);
  assert.equal(resolveAssignableMaster("Леша").chatId, MASTER_CHAT_IDS["ЛЕША"]);
  const slava = resolveAssignableMaster("Вячеслав");
  assert.equal(slava.ok, false);
  assert.match(slava.reason, /нет Telegram-чата/);
  assert.equal(isAssignableMaster("Вячеслав"), false);
  const unknown = resolveAssignableMaster("Зинаида");
  assert.equal(unknown.ok, false);
  assert.equal(dir.getAssignableNames().length, 11);
  for (const n of ["Антон", "Рома", "Тимур", "Семён", "Леша", "Евгений", "Владимир", "Алексей", "Дима", "Даниил", "Углов"]) {
    assert.match(unknown.reason, new RegExp(n), n);
  }
  assert.doesNotMatch(unknown.reason, /Вячеслав/);
});

test("новый мастер из базы виден везде: чат, топливо, бот, разбор имён", async () => {
  dir._setForTests({ refresh: true, loader: async () => ({ data: dbRows([DENIS]), error: null }) });
  assert.equal(dir.getSource(), "fallback");
  await dir.refresh();
  assert.equal(dir.getSource(), "db");
  assert.equal(await dir.getChatId("ДЕНИС"), DENIS.tg_chat_id);
  assert.equal(await dir.getChatId("денис"), DENIS.tg_chat_id);
  assert.equal(getFuelTableKey("Денис"), "denis");
  assert.equal(resolveAssignableMaster("Денис").ok, true);
  assert.equal(resolveAssignableMaster("Дениса").canonical, "Денис");
  assert.equal(resolveMasterName("Дениса").found, true);
  assert.ok(canonicalMasters().includes("Денис"));
});

test("база непустая — она главная: мастера, которого в базе нет, запас не вернёт", async () => {
  const rows = dbRows().filter((r) => r.key !== "dima");
  dir._setForTests({ refresh: true, loader: async () => ({ data: rows, error: null }) });
  await dir.refresh();
  assert.equal(dir.findByName("Дима"), null);
  assert.equal(getFuelTableKey("Дима"), null);
});

test("ушедший мастер: ключ топлива остаётся (старые записи), назначить нельзя", async () => {
  const rows = dbRows().map((r) => (r.key === "evgeniy" ? { ...r, is_active: false } : r));
  dir._setForTests({ refresh: true, loader: async () => ({ data: rows, error: null }) });
  await dir.refresh();
  assert.equal(getFuelTableKey("Евгений"), "evgeniy");
  assert.equal(isAssignableMaster("Евгений"), false);
  assert.equal(resolveAssignableMaster("Евгений").ok, false);
  assert.ok(!dir.getCanonicalNames().includes("Евгений"));
});

test("ошибка и пустой ответ базы: остаётся прежний список", async () => {
  dir._setForTests({ refresh: true, loader: async () => ({ data: null, error: { message: "boom" } }) });
  assert.equal(await dir.refresh(), false);
  assert.equal(dir.getSource(), "fallback");
  dir._setForTests({ refresh: true, loader: async () => ({ data: [], error: null }) });
  assert.equal(await dir.refresh(), false);
  assert.equal(dir.getSource(), "fallback");
  assert.equal(dir.findByName("Леша").key, "lesha");
});

test("сбой после удачного чтения не стирает снимок из базы", async () => {
  let ok = true;
  dir._setForTests({ refresh: true, loader: async () => (ok ? { data: dbRows([DENIS]), error: null } : { data: null, error: { message: "down" } }) });
  await dir.refresh();
  assert.ok(dir.findByName("Денис"));
  ok = false;
  assert.equal(await dir.refresh(), false);
  assert.ok(dir.findByName("Денис"));
  assert.equal(dir.getSource(), "db");
});

test("промах: только что заведённый мастер находится перечиткой, не чаще раза в 10 секунд", async () => {
  let calls = 0;
  let withDenis = false;
  dir._setForTests({
    refresh: true,
    loader: async () => {
      calls += 1;
      return { data: dbRows(withDenis ? [DENIS] : []), error: null };
    },
  });
  await dir.refresh();
  assert.equal(calls, 1);
  assert.equal(await dir.getChatId("ДЕНИС"), null);
  const afterMiss = calls;
  withDenis = true;
  assert.equal(await dir.getChatId("ДЕНИС"), null, "в течение 10 секунд повторно базу не дёргаем");
  assert.equal(calls, afterMiss);
});

test("параллельные перечитки делят один запрос", async () => {
  let calls = 0;
  dir._setForTests({ refresh: true, loader: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { data: dbRows(), error: null }; } });
  await Promise.all([dir.refresh(), dir.refresh(), dir.refresh()]);
  assert.equal(calls, 1);
});

test("два мастера с одинаковым именем без «ё»: побеждает активный с чатом, имя в списке одно", async () => {
  const ghost = { key: "semen_old", name: "Семен", is_active: false, tg_chat_id: null, tg_key: "СЕМЕН", sort_order: 99 };
  dir._setForTests({ refresh: true, loader: async () => ({ data: dbRows([ghost]), error: null }) });
  await dir.refresh();
  assert.equal(dir.findByName("Семён").key, "semen");
  assert.equal(dir.findByTgKeyOrName("СЕМЕН").key, "semen");
  assert.equal(await dir.getChatId("СЕМЕН"), MASTER_CHAT_IDS["СЕМЕН"]);
  assert.equal(dir.getCanonicalNames().filter((n) => dir.normName(n) === "семен").length, 1);
});
