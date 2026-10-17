"use strict";

// Журнал вебхуков Mango (logging.js): в подробном режиме и в консоли, и в файле mango_webhook_debug.jsonl
// ключ vpbx_api_key и подпись sign скрыты. Файл подменён: на диск тест не пишет.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test mango.calls.new/logging.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

process.env.MANGO_LOG_LEVEL = "verbose";
const { logMangoWebhook } = require("./logging");

const KLYUCH = "VPBX-KLYUCH-SEKRET-111";
const PODPIS = "PODPIS-SEKRET-222";

test("а) verbose: vpbx_api_key и sign скрыты и в консоли (RAW, PARSED), и в записи файла; остальное цело", (t) => {
  const konsol = [];
  const fajl = [];
  t.mock.method(console, "log", (...args) => konsol.push(args.join(" ")));
  t.mock.method(fs, "appendFileSync", (put, stroka) => fajl.push(stroka));

  const syroe = { vpbx_api_key: KLYUCH, sign: PODPIS, json: JSON.stringify({ entry_id: "E-1", call_state: "Appeared" }) };
  const razobrano = { ...syroe, entry_id: "E-1", call_state: "Appeared" };
  logMangoWebhook({ url: "/events/call" }, syroe, razobrano);

  assert.equal(fajl.length, 1, "в файл ушла одна строка");
  const vse = konsol.join("\n") + fajl.join("\n");
  assert.ok(!vse.includes(KLYUCH), "ключ попал в лог");
  assert.ok(!vse.includes(PODPIS), "подпись попала в лог");
  const zapis = JSON.parse(fajl[0]);
  assert.equal(zapis.raw.vpbx_api_key, "[скрыт]");
  assert.equal(zapis.raw.sign, "[скрыт]");
  assert.equal(zapis.parsed.vpbx_api_key, "[скрыт]");
  assert.equal(zapis.parsed.sign, "[скрыт]");
  assert.equal(zapis.parsed.entry_id, "E-1");
  assert.equal(zapis.raw.json, syroe.json);
  assert.equal(zapis.path, "/events/call");
  // исходные объекты не испорчены: дальше с ними работает обработчик
  assert.equal(syroe.vpbx_api_key, KLYUCH);
  assert.equal(razobrano.sign, PODPIS);
});
