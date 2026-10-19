"use strict";

// Маршрут POST /api/pdf/smeta без Chrome (PLANS/SERVER/05-pdf-smet, буква Б): пропуск, 400 (пусто, потолок, числа, сборка),
// ответ и имя файла, 502, 503, клиент ушёл, тело больше 1 МБ. Настоящий Chrome здесь не запускается: печать подменена.
// Очередь печатника — brauzer.test.js, страница сметы — pechat.test.js, шаблон — shablon.test.js.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/route.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Fastify = require("fastify");
const { registerPdfSmetRoute, zagolovokFayla } = require("./route");
const { sozdatPechatnika, PechatZanyata } = require("./brauzer");

const TOKEN = "Bearer test";
const POZICIYA = { id: "p1", productType: "roller_mini", productLabel: "Рулонная штора MINI", materialName: "Ткань", quantity: 2, price: 10000 };
const PDF = Buffer.from("%PDF-1.4 подмена");

function telo(dop = {}) {
  return {
    clientData: { appealId: "#09784", clientName: "Тест Тестов", phone: "", city: "Химки", address: "" },
    items: [POZICIYA],
    printDay: "2026-10-17",
    createdDay: "2026-09-12",
    ...dop,
  };
}

// Пропуск как у assertAuthenticatedFromRequest: нет заголовка — сам отвечает 401 и возвращает null
async function propuskPoZagolovku(request, reply) {
  if (request.headers.authorization !== TOKEN) {
    reply.code(401).send({ error: "unauthorized", message: "Нужен Authorization: Bearer" });
    return null;
  }
  return { id: "polzovatel" };
}

// Шумят console.log/error/warn маршрута и пробы — в тесте их заглушаем
function tishina(t) {
  for (const imya of ["log", "error", "warn"]) t.mock.method(console, imya, () => {});
}

// Маршрут с подменой печати; vyzovy — html, с которыми звали печать
async function sobrat(t, { pechatat, propusk = propuskPoZagolovku } = {}) {
  const vyzovy = [];
  const app = Fastify();
  registerPdfSmetRoute(app, {
    propusk,
    pechatat: pechatat || (async (html) => { vyzovy.push(html); return PDF; }),
  });
  t.after(() => app.close());
  return { app, vyzovy };
}

const otpravit = (app, payload, headers = { authorization: TOKEN }) =>
  app.inject({ method: "POST", url: "/api/pdf/smeta", headers, payload });

test("без пропуска — 401, печать не зовут", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo(), {});
  assert.equal(res.statusCode, 401);
  assert.equal(vyzovy.length, 0);
});

test("пропуск по умолчанию — assertAuthenticatedFromRequest: без Bearer 401 до всякой печати", async (t) => {
  tishina(t);
  const app = Fastify();
  let pechatali = 0;
  registerPdfSmetRoute(app, { pechatat: async () => { pechatali++; return PDF; } });
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/api/pdf/smeta", payload: telo() });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "unauthorized");
  assert.equal(pechatali, 0);
});

test("пустой items — 400 (пустой массив, нет поля, не массив, пустое тело)", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  for (const payload of [telo({ items: [] }), { clientData: null }, telo({ items: "x" }), {}]) {
    const res = await otpravit(app, payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 60));
    assert.equal(res.json().error, "No items provided");
  }
  assert.equal(vyzovy.length, 0);
});

test("тело, из которого смета не собирается, — 400 словами, сервер жив", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo({ items: [null] }));
  assert.equal(res.statusCode, 400);
  assert.match(res.json().details, /Смета не собралась/);
  assert.equal(vyzovy.length, 0);
  assert.equal((await otpravit(app, telo())).statusCode, 200);
});

test("ответ — application/pdf и имя файла как в index.ts; в печать уходит HTML сметы", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo());
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "application/pdf");
  assert.equal(res.headers["content-disposition"], `attachment; filename="#09784.pdf"; filename*=UTF-8''%2309784.pdf`);
  assert.deepEqual(res.rawPayload, PDF);
  assert.equal(vyzovy.length, 1);
  assert.match(vyzovy[0], /Тест Тестов/);
  assert.match(vyzovy[0], /Рулонная штора MINI/);
  // В печать уходит страница нового вида: лист A5 задаёт её @page (pechat.js берёт размер оттуда), подвал «Лист k из M» — в ней же
  assert.match(vyzovy[0], /@page \{\s*size: 420pt 595pt;/);
  assert.ok(vyzovy[0].includes('content: "Лист " counter(page) " из " counter(pages);'));
});

test("тело целиком доходит до страницы: группы, монтаж, срок КП, акция, НДС 5% и НДС 22%; headerImageUrl на смету не влияет", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo({
    headerImageUrl: "https://evil.example/oblozhka.png",
    groups: [{ id: "g1", name: "Ткань" }],
    items: [
      { ...POZICIYA, id: "a", productLabel: "Без группы" },
      { ...POZICIYA, id: "b", productLabel: "Вариант А", groupId: "g1", price: 8000, vatEnabled: true },
      { ...POZICIYA, id: "c", productLabel: "Вариант Б", groupId: "g1", price: 12000, vatEnabled: true },
    ],
    montage: { mode: "included" },
    validUntil: "2026-10-22",
    promoDiscount: 15,
    vatIncluded5: true,
  }));
  assert.equal(res.statusCode, 200);
  const html = vyzovy[0];
  assert.ok(html.includes('<span class="cd-gr">Гр.\u00a01</span>'));
  assert.match(html, /включён в стоимость/);
  assert.match(html, /<div class="tb-vmain">Предложение действительно 40 дней — до <b>22\.10\.2026<\/b><\/div>/);
  assert.match(html, /в размере 15%/);
  assert.match(html, /включают НДС 5%/);
  assert.match(html, /НДС 22%/);
  assert.match(html, /<span class="tb-w">от<\/span>/); // варианты группы разной цены — диапазон в итоге
  assert.ok(!html.includes("evil.example"), "адрес из headerImageUrl попал в страницу");
});

test("без номера обращения файл «smeta-день.pdf»", async (t) => {
  tishina(t);
  const { app } = await sobrat(t);
  const res = await otpravit(app, telo({ clientData: { clientName: "Без номера" } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-disposition"], `attachment; filename="smeta-2026-10-17.pdf"; filename*=UTF-8''smeta-2026-10-17.pdf`);
});

test("номер обращения с кириллицей, кавычкой и переводом строки: заголовок цел, лишнего заголовка нет", async (t) => {
  tishina(t);
  const { app } = await sobrat(t);
  const res = await otpravit(app, telo({ clientData: { appealId: '#№ 5"\r\nX-Evil: 1', clientName: "Иванов" } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-disposition"], /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''[A-Za-z0-9%._~!'()*-]*$/);
  assert.ok(!res.headers["content-disposition"].includes("\n"));
  assert.equal(res.headers["x-evil"], undefined);
  assert.equal(zagolovokFayla("#09784.pdf"), `attachment; filename="#09784.pdf"; filename*=UTF-8''%2309784.pdf`);
});

test("печать упала — 502 словами, а следующий запрос проходит (сервер не упал)", async (t) => {
  tishina(t);
  let vyzov = 0;
  const { app } = await sobrat(t, {
    pechatat: async () => { if (++vyzov === 1) throw new Error("Chrome упал на старте"); return PDF; },
  });
  const upal = await otpravit(app, telo());
  assert.equal(upal.statusCode, 502);
  assert.equal(upal.json().error, "PDF generation failed");
  assert.match(upal.json().details, /Не удалось напечатать PDF/);
  assert.equal((await otpravit(app, telo())).statusCode, 200);
});

test("печать занята — 503 и Retry-After", async (t) => {
  tishina(t);
  const { app } = await sobrat(t, { pechatat: async () => { throw new PechatZanyata(); } });
  const res = await otpravit(app, telo());
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["retry-after"], "60");
  assert.match(res.json().details, /Печать занята, повторите через минуту/);
});


test("потолок: больше 400 позиций или 100 групп — 400 словами, печать не зовут; ровно 400 и 100 проходят", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const pozicii = (n) => Array.from({ length: n }, (_, i) => ({ ...POZICIYA, id: `p${i}` }));
  const gruppy = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, name: `Вариант ${i}` }));

  const mnogoPozicij = await otpravit(app, telo({ items: pozicii(401) }));
  assert.equal(mnogoPozicij.statusCode, 400);
  assert.equal(mnogoPozicij.json().error, "Too many items");
  assert.match(mnogoPozicij.json().details, /слишком много позиций или групп/);

  const mnogoGrupp = await otpravit(app, telo({ groups: gruppy(101) }));
  assert.equal(mnogoGrupp.statusCode, 400);
  assert.equal(mnogoGrupp.json().error, "Too many items");

  assert.equal(vyzovy.length, 0);
  assert.equal((await otpravit(app, telo({ items: pozicii(400), groups: gruppy(100) }))).statusCode, 200);
  assert.equal(vyzovy.length, 1);
});

test("числа: «<h1>» в quantity, «abc» в price, мусор в скидках и 1e999 — 400 «неверные числа в смете», печать не зовут", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const { price, ...bezCeny } = POZICIYA;
  const plohie = [
    [telo({ items: [{ ...POZICIYA, quantity: "<h1>" }] }), "quantity <h1>"],
    [telo({ items: [{ ...POZICIYA, price: "abc" }] }), "price abc"],
    [telo({ items: [{ ...POZICIYA, discountPercent: "10%" }] }), "discountPercent 10%"],
    [telo({ items: [{ ...POZICIYA, quantity: null }] }), "quantity null"],
    [telo({ items: [bezCeny] }), "price нет"],
    [telo({ items: [{ ...POZICIYA, price: true }] }), "price true"],
    [telo({ items: [{ ...POZICIYA, quantity: [2] }] }), "quantity [2]"],
    [telo({ items: [{ ...POZICIYA, price: "  " }] }), "price пробелы"],
    [telo({ items: [{ ...POZICIYA, discountedPrice: "<u>x</u>" }] }), "discountedPrice <u>"],
    [telo({ items: [{ ...POZICIYA, vatAmount: "abc" }] }), "vatAmount abc"],
    [telo({ items: [{ ...POZICIYA, finalPriceWithVat: "<i>1</i>" }] }), "finalPriceWithVat <i>"],
    [telo({ items: [{ ...POZICIYA, vatPercent: "22%" }] }), "vatPercent 22%"],
    [telo({ promoDiscount: "<b>5</b>" }), "promoDiscount <b>"],
    [telo({ promoDiscount: {} }), "promoDiscount {}"],
  ];
  for (const [payload, chto] of plohie) {
    const res = await otpravit(app, payload);
    assert.equal(res.statusCode, 400, chto);
    assert.equal(res.json().error, "Invalid numbers", chto);
    assert.match(res.json().details, /неверные числа в смете/i, chto);
  }
  // В тексте JSON 1e999 разбирается в Infinity: не конечное число
  const beskonechnost = await app.inject({
    method: "POST", url: "/api/pdf/smeta", headers: { authorization: TOKEN, "content-type": "application/json" },
    payload: '{"clientData":{"appealId":"#1"},"items":[{"productLabel":"x","quantity":1e999,"price":1}]}',
  });
  assert.equal(beskonechnost.statusCode, 400);
  assert.equal(beskonechnost.json().error, "Invalid numbers");
  assert.equal(vyzovy.length, 0);
});

test("числа: строка-число приводится к числу и в страницу идёт числом; null и пропуск promoDiscount и discountPercent допустимы", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo({ items: [{ ...POZICIYA, quantity: "3", price: " 12500 ", discountPercent: "10" }], promoDiscount: "15" }));
  assert.equal(res.statusCode, 200);
  // Строки стали числами: количество «3», цена с разделителем тысяч «12 500» (а не строка " 12500 "), скидка «−10%» чипом, акция «15%»
  assert.ok(vyzovy[0].includes('<span class="cd-qty">3\u00a0шт.</span>'));
  assert.ok(vyzovy[0].includes('<s class="cd-old">12\u00a0500 ₽</s><span class="cd-off">\u221210%</span>'));
  assert.match(vyzovy[0], /в размере 15%/);

  for (const dop of [{ promoDiscount: null }, {}, { items: [{ ...POZICIYA, discountPercent: null }] }, { items: [{ ...POZICIYA, discountPercent: 0 }] }]) {
    assert.equal((await otpravit(app, telo(dop))).statusCode, 200, JSON.stringify(dop).slice(0, 60));
  }
  assert.equal(vyzovy.length, 5);
});

test("одиночный суррогат в номере обращения: 200 и заголовок цел (раньше URIError и 500 уже после печати)", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo({ clientData: { appealId: "#5\ud800x", clientName: "Иванов" } }));
  assert.equal(res.statusCode, 200);
  assert.equal(vyzovy.length, 1);
  assert.equal(res.headers["content-disposition"], `attachment; filename="#5_x.pdf"; filename*=UTF-8''%235%EF%BF%BDx.pdf`);
  assert.deepEqual(res.rawPayload, PDF);
  assert.doesNotThrow(() => zagolovokFayla("#5\ud800.pdf"));
  assert.doesNotThrow(() => zagolovokFayla("\udfff#5.pdf"));
});

test("сбой: клиенту общая фраза без текста ошибки и путей, полный текст — в console.error", async (t) => {
  const log = [];
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", (...args) => { log.push(args); });
  const TEKST = "spawn /tmp/chromium ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:285:19)";
  const { app } = await sobrat(t, { pechatat: async () => { throw new Error(TEKST); } });

  const upal = await otpravit(app, telo());
  assert.equal(upal.statusCode, 502);
  assert.match(upal.json().details, /Не удалось напечатать PDF/);
  assert.doesNotMatch(upal.payload, /tmp\/chromium|ENOENT|child_process/);
  assert.ok(log.some((args) => args.some((a) => a instanceof Error && a.message === TEKST)), "полного текста ошибки нет в console.error");

  const ploho = await otpravit(app, telo({ items: [null] }));
  assert.equal(ploho.statusCode, 400);
  assert.match(ploho.json().details, /Смета не собралась/);
  assert.doesNotMatch(ploho.payload, /Cannot read|TypeError|properties/);
  assert.ok(log.some((args) => args.some((a) => a instanceof TypeError)), "полного текста ошибки сборки нет в console.error");
});

test("день печати: printDay не прислан — одно значение по Москве и в смете, и в имени файла (22:30 UTC 17.10 — уже 18.10)", async (t) => {
  tishina(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-17T22:30:00Z") });
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, telo({ printDay: undefined, clientData: { clientName: "Без номера" } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-disposition"], `attachment; filename="smeta-2026-10-18.pdf"; filename*=UTF-8''smeta-2026-10-18.pdf`);
  assert.match(vyzovy[0], /Дата: <b>18\.10\.2026<\/b>/);
});

test("тело больше 1 МБ — 413, пропуск и печать не зовут; чуть меньше — проходит", async (t) => {
  tishina(t);
  // Как у сервера (server.js): общий предел 55 МБ; 1 МБ для этого маршрута задаёт сам маршрут
  const app = Fastify({ bodyLimit: 55 * 1024 * 1024 });
  const propuski = [];
  const vyzovy = [];
  registerPdfSmetRoute(app, {
    propusk: async (request) => { propuski.push(request.url); return { id: "polzovatel" }; },
    pechatat: async (html) => { vyzovy.push(html); return PDF; },
  });
  t.after(() => app.close());
  const otpravit1 = (payload) => app.inject({ method: "POST", url: "/api/pdf/smeta", headers: { authorization: TOKEN }, payload });

  const bolshoe = await otpravit1(telo({ zametka: "x".repeat(1024 * 1024) }));
  assert.equal(bolshoe.statusCode, 413);
  assert.equal(propuski.length, 0);
  assert.equal(vyzovy.length, 0);

  const pochti = await otpravit1(telo({ zametka: "x".repeat(1024 * 1024 - 2048) }));
  assert.equal(pochti.statusCode, 200);
  assert.equal(propuski.length, 1);
  assert.equal(vyzovy.length, 1);
});

// --- клиент ушёл: настоящий http-сервер Fastify (порт 0), настоящая очередь печатника, подставные Chrome и печать ---

const tik = () => new Promise((resolve) => setImmediate(resolve));
const spat = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function dozhdatsya(uslovie, chto, ms = 3000) {
  const konec = Date.now() + ms;
  while (!uslovie()) {
    if (Date.now() > konec) assert.fail(`не дождались: ${chto}`);
    await spat(5);
  }
}

// POST смету по настоящему сокету; req.destroy() — клиент рвёт соединение. otvet — {status, body} или "oborvano"
function prosba(port, payload) {
  const tekst = JSON.stringify(payload);
  let req;
  const otvet = new Promise((resolve) => {
    req = http.request({
      host: "127.0.0.1", port, method: "POST", path: "/api/pdf/smeta", agent: false,
      headers: { authorization: TOKEN, "content-type": "application/json", "content-length": Buffer.byteLength(tekst) },
    }, (res) => {
      const chasti = [];
      res.on("data", (c) => chasti.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chasti) }));
      res.on("error", () => resolve("oborvano"));
    });
    req.on("error", () => resolve("oborvano"));
    req.end(tekst);
  });
  return { req, otvet };
}

test("клиент ушёл, пока печать занята другим: вторую смету не печатают, Chrome не запускают, ответа нет, место свободно", async (t) => {
  const zhurnal = [];
  t.mock.method(console, "log", (...args) => { zhurnal.push(args.join(" ")); });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  // Подставной Chrome и печать: печать стоит, пока тест не отпустит её через otpustit()
  const s = { zapuskov: 0, zakryto: 0, napechatano: [], zhdut: [] };
  const pechatnik = sozdatPechatnika({
    zapustit: async () => { s.zapuskov++; return { close: async () => { s.zakryto++; }, process: () => null }; },
    pechatat: async (browser, html) => { s.napechatano.push(html); await new Promise((r) => { s.zhdut.push(r); }); return Buffer.from("%PDF-подмена"); },
    srok: 5000,
  });
  const voshli = []; // html, с которыми маршрут позвал печатника (в том числе ждущие места)
  const app = Fastify();
  registerPdfSmetRoute(app, {
    propusk: propuskPoZagolovku,
    pechatat: (html, opts) => { voshli.push(html); return pechatnik(html, opts); },
  });
  t.after(() => app.close());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = app.server.address().port;
  const smeta = (appealId) => telo({ clientData: { appealId, clientName: `Клиент ${appealId}` } });

  const pervyy = prosba(port, smeta("#1"));
  await dozhdatsya(() => s.zhdut.length === 1, "первая печать стоит");
  const vtoroy = prosba(port, smeta("#2"));
  await dozhdatsya(() => voshli.length === 2, "вторая смета ждёт места");

  // Клиент рвёт соединение, пока печать занята первой
  vtoroy.req.destroy();
  assert.equal(await vtoroy.otvet, "oborvano");
  // Сервер заметил обрыв, когда от двух открытых соединений осталось одно (первое ждёт печать)
  const konecOzhidaniya = Date.now() + 3000;
  while ((await new Promise((r) => app.server.getConnections((e, n) => r(n)))) > 1) {
    if (Date.now() > konecOzhidaniya) assert.fail("сервер не заметил обрыв соединения");
    await spat(5);
  }
  await tik();

  // Первая печать кончилась — место доходит до ушедшего клиента
  s.zhdut.shift()();
  const otvet1 = await pervyy.otvet;
  assert.equal(otvet1.status, 200);
  assert.equal(otvet1.body.toString(), "%PDF-подмена");
  await dozhdatsya(() => zhurnal.some((l) => /клиент ушёл/.test(l)), "route.js увидел, что клиент ушёл");

  assert.equal(s.napechatano.length, 1, "подставная печать вызвана не один раз");
  assert.match(s.napechatano[0], /Клиент #1/);
  assert.equal(s.zapuskov, 1, "Chrome запускали для ушедшего клиента");
  assert.equal(s.zakryto, 1);

  // Место свободно: следующая смета печатается
  const tretiy = prosba(port, smeta("#3"));
  await dozhdatsya(() => s.zhdut.length === 1, "третья печать стоит");
  s.zhdut.shift()();
  assert.equal((await tretiy.otvet).status, 200);
  assert.equal(s.napechatano.length, 2);
  assert.match(s.napechatano[1], /Клиент #3/);
});
