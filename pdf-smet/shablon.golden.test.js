"use strict";

// Golden-тест сметы (PLANS/SERVER/05-pdf-smet, буква Б «Цена без сюрпризов» + Акция, 20.10.2026): HTML для СТАРЫХ тел запроса (без priceMode, promoFromQty, promoApply) побайтно такой же,
// как до буквы Б. Образцы — golden-payloady/*.json (выдуманные: 12 образцов отбора вида + 10 стресс-образцов от 1 до 30 позиций, группы, скидки, НДС, акция, монтаж), эталонные хэши sha256 —
// golden-html.json (сняты с кода ДО правок буквы Б, цепочка как у route.js: privestiChisla → dozapolnitPozicii → buildHtml с printDay из тела).
// Печатается тем же путём, что в бою: через маршрут POST /api/pdf/smeta с подменой печати — берём HTML, который ушёл бы в Chrome.
// Менять golden-html.json можно только осознанно: изменился вид старых смет — это решение главного чата, а не побочный эффект правки.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/shablon.golden.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Fastify = require("fastify");
const { registerPdfSmetRoute } = require("./route");

const PAPKA = path.join(__dirname, "golden-payloady");
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "golden-html.json"), "utf8"));
const IMENA = fs.readdirSync(PAPKA).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const telo = (imya) => JSON.parse(fs.readFileSync(path.join(PAPKA, `${imya}.json`), "utf8"));

test("golden: набор образцов совпадает с набором хэшей, а в образцах нет новых полей (иначе это уже не «старые» тела)", () => {
  assert.deepEqual(IMENA, Object.keys(GOLDEN).sort());
  assert.ok(IMENA.length >= 12, `образцов ${IMENA.length}, нужно не меньше 12`);
  for (const imya of IMENA) {
    const body = telo(imya);
    for (const pole of ["promoFromQty", "promoApply"]) assert.ok(!(pole in body), `${imya}: в старом теле есть ${pole}`);
    for (const item of body.items) assert.ok(!("priceMode" in item), `${imya}: в старой позиции есть priceMode`);
  }
});

for (const imya of IMENA) {
  test(`golden: ${imya} — HTML старого тела побайтно прежний (sha256)`, async (t) => {
    for (const m of ["log", "error", "warn"]) t.mock.method(console, m, () => {});
    let html = null;
    const app = Fastify();
    registerPdfSmetRoute(app, { propusk: async () => ({ id: "polzovatel" }), pechatat: async (h) => { html = h; return Buffer.from("%PDF-1.4 подмена"); } });
    t.after(() => app.close());
    const res = await app.inject({ method: "POST", url: "/api/pdf/smeta", headers: { authorization: "Bearer test" }, payload: telo(imya) });
    assert.equal(res.statusCode, 200, `${imya}: маршрут не принял старое тело`);
    assert.equal(crypto.createHash("sha256").update(html).digest("hex"), GOLDEN[imya], `${imya}: HTML старой сметы изменился`);
  });
}
