"use strict";

// Шаблон сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква Б): имя файла, рамка срока, экранирование.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/shablon.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, dozapolnitPozicii, imyaFayla, SUPABASE_URL } = require("./shablon");

const OBLOZHKA = `${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/oblojkafull.jpg`;
const POZICIYA = {
  id: "p1",
  productType: "roller_mini",
  productLabel: "Рулонная штора MINI",
  materialName: "Ткань",
  quantity: 2,
  price: 10000,
};

// Тело запроса как у CRM; dop переопределяет поля. Возвращает готовый HTML.
function smeta(dop = {}) {
  const body = {
    clientData: { appealId: "#09784", clientName: "Тест Тестов", phone: "8(900)000-00-00", city: "Химки", address: "" },
    items: [POZICIYA],
    headerImageUrl: OBLOZHKA,
    promoDiscount: null,
    vatIncluded5: false,
    groups: [],
    validUntil: null,
    createdDay: "2026-09-12",
    printDay: "2026-10-17",
    ...dop,
  };
  return buildHtml({ ...body, items: dozapolnitPozicii(body.items) });
}

test("имя файла: «#номер.pdf», а без номера обращения «smeta-день.pdf»", () => {
  assert.equal(imyaFayla({ clientData: { appealId: "#09784" } }), "#09784.pdf");
  assert.equal(imyaFayla({ clientData: { appealId: " #123 " } }), "#123.pdf");
  assert.equal(imyaFayla({ clientData: { clientName: "без номера" }, printDay: "2026-10-17" }), "smeta-2026-10-17.pdf");
  assert.equal(imyaFayla({ clientData: null, printDay: "2026-10-17" }), "smeta-2026-10-17.pdf");
});

test("имя файла без printDay: день по Москве, а не по UTC", (t) => {
  // 22:30 UTC 16 октября — в Москве уже 01:30 17 октября
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-16T22:30:00Z") });
  assert.equal(imyaFayla({ clientData: null }), "smeta-2026-10-17.pdf");
});

test("рамка срока: с validUntil — «до ДД.ММ.ГГГГ» и день составления, без — прежняя фраза про 14 дней", () => {
  const sSrokom = smeta({ validUntil: "2026-10-22", createdDay: "2026-10-08" });
  assert.match(sSrokom, /class="validity-main">Предложение действительно 14 дней<br><b>до 22\.10\.2026<\/b>/);
  assert.match(sSrokom, /class="validity-sub">Смета составлена 08\.10\.2026</);
  assert.doesNotMatch(sSrokom, /действительно в течение 14 дней/);

  const bezSroka = smeta({ validUntil: null, printDay: "2026-10-17" });
  assert.match(bezSroka, /действительно в течение 14 дней/);
  assert.match(bezSroka, /Дата: <strong>17\.10\.2026<\/strong>/);
  assert.doesNotMatch(bezSroka, /class="validity-main"/);
});

test("настоящий адрес обложки и даты экранирование не меняет", () => {
  const html = smeta({ validUntil: "2026-10-22", createdDay: "2026-10-08" });
  assert.ok(html.includes(`<img src="${OBLOZHKA}" class="header-image" />`));
  assert.ok(html.includes("<b>до 22.10.2026</b>"));
});

test("кавычка в headerImageUrl экранируется: тег <img> не рвётся и атрибут не дописать", () => {
  const html = smeta({ headerImageUrl: 'https://evil.example/a.png" onerror="alert(1)' });
  // Тег цел: весь адрес лежит в одном src, дальше сразу class="header-image"
  const tag = html.match(/<img src="([^"]*)" class="header-image" \/>/);
  assert.ok(tag, "тег обложки разорван кавычкой из headerImageUrl");
  assert.equal(tag[1], "https://evil.example/a.png&quot; onerror=&quot;alert(1)");
  assert.ok(!html.includes('onerror="alert(1)"'));
});

test("скобки в headerImageUrl не открывают теги; <script> в странице нет", () => {
  const html = smeta({ headerImageUrl: 'x"><script>alert(1)</script>' });
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes("x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("даты экранируются: validUntil, createdDay и printDay не вставляют разметку", () => {
  const sSrokom = smeta({ validUntil: "2026-10-22<b>x</b>", createdDay: '"><i>1</i>' });
  assert.ok(!sSrokom.includes("<b>x</b>"));
  assert.ok(!sSrokom.includes("<i>1</i>"));
  assert.ok(sSrokom.includes("22&lt;b&gt;x&lt;/b&gt;.10.2026"));
  assert.ok(sSrokom.includes("&quot;&gt;&lt;i&gt;1&lt;/i&gt;"));

  const bezSroka = smeta({ validUntil: null, printDay: "<u>1</u>" });
  assert.ok(!bezSroka.includes("<u>1</u>"));
  assert.ok(bezSroka.includes("Дата: <strong>&lt;u&gt;1&lt;/u&gt;</strong>"));
});
