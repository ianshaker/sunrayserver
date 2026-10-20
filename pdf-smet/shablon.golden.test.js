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

// --- форматы листа «компактный» и «ПК» и город объекта (20.10.2026) ---
// Те же образцы, но с полем sheet (compact, pc) и cityContext; эталонные хэши sha256 — golden-html-sheets.json. Сняты с кода 20.10.2026 той же цепочкой, что у большого golden
// (маршрут → privestiChisla → dozapolnitPozicii → buildHtml с printDay из тела), и есть эталон НОВОГО вида. Большой golden выше не тронут и обязан остаться зелёным: его тела — без sheet и cityContext.
// Менять golden-html-sheets.json можно только осознанно: изменился вид компактного листа, листа «ПК» или города — это решение главного чата, а не побочный эффект правки.
const GOLDEN_FORMATY = JSON.parse(fs.readFileSync(path.join(__dirname, "golden-html-sheets.json"), "utf8"));
const OBRAZCY_FORMATOV = ["odna", "chetyre", "katalog-akciya-nds5", "gruppy", "dlinnaya", "vse-vmeste"];
const GOROD = { name: "Истра", siteHost: "istra.zhalyuzi-sunray.ru" };
// 12 случаев «образец × формат» и 3 случая «chetyre с городом во всех форматах»; ключ — то, что лежит в golden-html-sheets.json
const SLUCHAI_FORMATOV = [
  ...OBRAZCY_FORMATOV.flatMap((imya) => ["compact", "pc"].map((sheet) => ({ klyuch: `${imya}:${sheet}`, imya, dop: { sheet } }))),
  ...["big", "compact", "pc"].map((sheet) => ({ klyuch: `chetyre:gorod:${sheet}`, imya: "chetyre", dop: { sheet, cityContext: GOROD } })),
];

test("golden (форматы): набор случаев совпадает с набором хэшей (6 образцов × compact, pc и chetyre с городом × big, compact, pc); в образцах нет sheet и cityContext; хэши все разные", () => {
  assert.deepEqual(SLUCHAI_FORMATOV.map((s) => s.klyuch).sort(), Object.keys(GOLDEN_FORMATY).sort());
  assert.equal(SLUCHAI_FORMATOV.length, 15);
  for (const imya of OBRAZCY_FORMATOV) {
    const body = telo(imya);
    for (const pole of ["sheet", "cityContext"]) assert.ok(!(pole in body), `${imya}: в образце уже есть ${pole}, а он добавляется в тесте`);
  }
  // Формат и город меняют страницу: ни один хэш не повторяет другой и не равен хэшу большого листа того же образца без города
  const khashi = Object.values(GOLDEN_FORMATY);
  assert.equal(new Set(khashi).size, khashi.length, "два случая дали одинаковый HTML");
  for (const khash of khashi) assert.match(khash, /^[0-9a-f]{64}$/);
  for (const imya of OBRAZCY_FORMATOV) assert.ok(!khashi.includes(GOLDEN[imya]), `${imya}: HTML другого формата совпал с большим листом`);
});

for (const { klyuch, imya, dop } of SLUCHAI_FORMATOV) {
  test(`golden (форматы): ${klyuch} — HTML побайтно прежний (sha256)`, async (t) => {
    for (const m of ["log", "error", "warn"]) t.mock.method(console, m, () => {});
    let html = null;
    const app = Fastify();
    registerPdfSmetRoute(app, { propusk: async () => ({ id: "polzovatel" }), pechatat: async (h) => { html = h; return Buffer.from("%PDF-1.4 подмена"); } });
    t.after(() => app.close());
    const res = await app.inject({ method: "POST", url: "/api/pdf/smeta", headers: { authorization: "Bearer test" }, payload: { ...telo(imya), ...dop } });
    assert.equal(res.statusCode, 200, `${klyuch}: маршрут не принял тело ${JSON.stringify(dop)}`);
    assert.equal(crypto.createHash("sha256").update(html).digest("hex"), GOLDEN_FORMATY[klyuch], `${klyuch}: HTML сметы изменился`);
  });
}
