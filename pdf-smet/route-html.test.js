"use strict";

// Маршрут POST /api/pdf/smeta-html без Chrome (PLANS/CRM/23-smeta-html-zoom): пропуск, проверка тела (400), потолок 2 МБ (413), ответ и заголовки,
// 502, 503, клиент ушёл, CORS, журнал без текста документа, сборка «маршрут → общая очередь → страница» на подставном Chrome.
// Настоящий Chrome здесь не запускается: печать или браузер подменены. Очередь печатника — brauzer.test.js, страница и белый список адресов — pechat.test.js.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/route-html.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const Fastify = require("fastify");
const { registerPdfSmetHtmlRoute, oshibkaHtml, BODY_MAX, HTML_MIN } = require("./route-html");
const { sozdatPechatnika, PechatZanyata } = require("./brauzer");
const { pechatatDokument, ARGUMENTY_ZAPRET_SETI } = require("./pechat");
const { SUPABASE_URL } = require("./shablon");

const URL_MARSHRUTA = "/api/pdf/smeta-html";
const TOKEN = "Bearer test";
const PDF = Buffer.from("%PDF-1.4 подмена");

// Печатный документ: лист A5 в @page, <html>, текст; добирается комментарием до нужного числа байт (по умолчанию 4 КБ — заведомо не короче 2 КБ)
function dokument({ razmer = 4096, telo = "Лист 1 · Иванов Иван Иванович" } = {}) {
  const html = `<!DOCTYPE html>\n<html lang="ru"><head><meta charset="UTF-8"><style>@page { size: 420pt 595pt; margin: 0 } body { margin: 0 }</style></head><body>${telo}</body></html>`;
  if (razmer === null) return html; // без добора: размер задаёт сам текст
  const dobor = razmer - Buffer.byteLength(html, "utf8");
  assert.ok(dobor >= 7, `документ не вместился в ${razmer} байт`);
  return html.replace("</body>", `<!--${"x".repeat(dobor - 7)}--></body>`);
}

// Пропуск как у assertAuthenticatedFromRequest: нет заголовка — сам отвечает 401 и возвращает null
async function propuskPoZagolovku(request, reply) {
  if (request.headers.authorization !== TOKEN) {
    reply.code(401).send({ error: "unauthorized", message: "Нужен Authorization: Bearer" });
    return null;
  }
  return { id: "polzovatel" };
}

// Шумят console.log/error/warn маршрута — в тесте их заглушаем
function tishina(t) {
  for (const imya of ["log", "error", "warn"]) t.mock.method(console, imya, () => {});
}

// Маршрут с подменой очереди печати; vyzovy — { html, opts }, с которыми маршрут звал печать
async function sobrat(t, { pechatat, propusk = propuskPoZagolovku } = {}) {
  const vyzovy = [];
  const app = Fastify();
  registerPdfSmetHtmlRoute(app, {
    propusk,
    pechatat: pechatat || (async (html, opts) => { vyzovy.push({ html, opts }); return PDF; }),
  });
  t.after(() => app.close());
  return { app, vyzovy };
}

const otpravit = (app, payload, headers = { authorization: TOKEN }) =>
  app.inject({ method: "POST", url: URL_MARSHRUTA, headers, payload });

test("без пропуска — 401, печать не зовут", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const res = await otpravit(app, { html: dokument() }, {});
  assert.equal(res.statusCode, 401);
  const chuzhoy = await otpravit(app, { html: dokument() }, { authorization: "Bearer chuzhoy" });
  assert.equal(chuzhoy.statusCode, 401);
  assert.equal(vyzovy.length, 0);
});

test("пропуск по умолчанию — assertAuthenticatedFromRequest: без Bearer 401 до всякой печати, и до проверки тела", async (t) => {
  tishina(t);
  const app = Fastify();
  let pechatali = 0;
  registerPdfSmetHtmlRoute(app, { pechatat: async () => { pechatali++; return PDF; } });
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: URL_MARSHRUTA, payload: { html: dokument() } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "unauthorized");
  const bezTela = await app.inject({ method: "POST", url: URL_MARSHRUTA, payload: {} });
  assert.equal(bezTela.statusCode, 401, "тело проверили раньше пропуска");
  assert.equal(pechatali, 0);
});

test("html: нет поля, null, пустая строка, одни пробелы, пустое тело, тело не объект — 400 «No html provided», печать не зовут", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  for (const payload of [{}, { html: null }, { html: "" }, { html: "   \n\t " }, { kto: "ne tot" }, [], [{ html: dokument() }], null]) {
    const res = await otpravit(app, payload === null ? "null" : payload, { authorization: TOKEN, "content-type": "application/json" });
    assert.equal(res.statusCode, 400, JSON.stringify(payload).slice(0, 60));
    assert.equal(res.json().error, "No html provided");
    assert.match(res.json().details, /html/);
  }
  assert.equal(vyzovy.length, 0);
});

test("html: не строка (число, true, массив, объект) — 400 «Invalid html»; тело не JSON — 400 от Fastify; печать не зовут", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  for (const html of [0, 42, true, false, [dokument()], { html: dokument() }]) {
    const res = await otpravit(app, { html });
    assert.equal(res.statusCode, 400, JSON.stringify(html).slice(0, 60));
    assert.equal(res.json().error, "Invalid html");
    assert.match(res.json().details, /строк/);
  }
  const plokho = await app.inject({ method: "POST", url: URL_MARSHRUTA, headers: { authorization: TOKEN, "content-type": "application/json" }, payload: "{html:" });
  assert.equal(plokho.statusCode, 400);
  assert.equal(vyzovy.length, 0);
});

test("html: короче 2 КБ — 400; ровно 2 КБ — проходит; считаются байты UTF-8, а не знаки", async (t) => {
  tishina(t);
  assert.equal(HTML_MIN, 2048);
  const { app, vyzovy } = await sobrat(t);
  const korotkiy = await otpravit(app, { html: dokument({ razmer: HTML_MIN - 1 }) });
  assert.equal(korotkiy.statusCode, 400);
  assert.equal(korotkiy.json().error, "Invalid html");
  assert.match(korotkiy.json().details, /короткий/);
  assert.equal(vyzovy.length, 0);

  const rovno = await otpravit(app, { html: dokument({ razmer: HTML_MIN }) });
  assert.equal(rovno.statusCode, 200);
  assert.equal(vyzovy.length, 1);

  // 1000 русских букв: знаков меньше 2048, а байт больше (2 байта на букву) — документ не короткий
  const kirillica = dokument({ telo: "я".repeat(1000), razmer: null });
  assert.ok(kirillica.length < HTML_MIN && Buffer.byteLength(kirillica, "utf8") >= HTML_MIN, "образец для проверки байтов собран неверно");
  assert.equal((await otpravit(app, { html: kirillica })).statusCode, 200);
  assert.equal(vyzovy.length, 2);
});

test("html: без «<html» или без «@page» — 400 «Invalid html» с понятным details; регистр не важен, «<htmlx>» и «@pages» не считаются", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  const doDobora = (html) => html + `<!--${"x".repeat(Math.max(0, HTML_MIN - Buffer.byteLength(html, "utf8")))}-->`;

  const bezHtml = await otpravit(app, { html: doDobora("<div>@page { size: 420pt 595pt }</div>") });
  assert.equal(bezHtml.statusCode, 400);
  assert.equal(bezHtml.json().error, "Invalid html");
  assert.match(bezHtml.json().details, /<html>/);

  const bezPage = await otpravit(app, { html: doDobora("<html><body>Лист без правила листа</body></html>") });
  assert.equal(bezPage.statusCode, 400);
  assert.equal(bezPage.json().error, "Invalid html");
  assert.match(bezPage.json().details, /@page/);

  const chuzhoyTeg = await otpravit(app, { html: doDobora("<htmlx><style>@page { size: 420pt 595pt }</style></htmlx>") });
  assert.equal(chuzhoyTeg.statusCode, 400);
  const chuzhoyPage = await otpravit(app, { html: doDobora("<html><style>@pages { size: 420pt 595pt }</style></html>") });
  assert.equal(chuzhoyPage.statusCode, 400);
  assert.equal(vyzovy.length, 0);

  // Регистр: теги и at-правила в CSS от него не зависят
  const zaglavnye = await otpravit(app, { html: doDobora("<HTML><STYLE>@PAGE { size: 420pt 595pt }</STYLE></HTML>") });
  assert.equal(zaglavnye.statusCode, 200);
  assert.equal(vyzovy.length, 1);

  // Чистая функция проверки: ответ — { error, details } или null
  assert.equal(oshibkaHtml({ html: dokument() }), null);
  assert.deepEqual(Object.keys(oshibkaHtml({}) || {}).sort(), ["details", "error"]);
});

test("ответ — application/pdf и файл smeta.pdf; в печать уходит html как пришёл, побайтно, и печатник страницы документа", async (t) => {
  tishina(t);
  const { app, vyzovy } = await sobrat(t);
  // Кавычки, обратная косая, переводы строки, русские буквы, эмодзи, </script> и ${} проходят JSON без искажений
  const telo = 'Иванов "Тест" \\ путь\nвторая строка\t· 😀 · </script> ${x} `y` · <svg><linearGradient id="g"/></svg>';
  const html = dokument({ telo });
  const res = await otpravit(app, { html });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /^application\/pdf/);
  assert.equal(res.headers["content-disposition"], `attachment; filename="smeta.pdf"; filename*=UTF-8''smeta.pdf`);
  assert.equal(res.headers["content-length"], String(PDF.length));
  assert.deepEqual(res.rawPayload, PDF);
  assert.equal(vyzovy.length, 1);
  assert.equal(vyzovy[0].html, html);
  assert.equal(typeof vyzovy[0].opts.klientTut, "function");
  assert.equal(vyzovy[0].opts.klientTut(), true);
  assert.equal(vyzovy[0].opts.pechatat, pechatatDokument, "в очередь ушёл не печатник страницы документа CRM");
  assert.deepEqual(vyzovy[0].opts.argumenty, ARGUMENTY_ZAPRET_SETI, "Chrome для документа CRM запускается без запрета сети");
});

test("тело больше 2 МБ — 413, пропуск и печать не зовут; чуть меньше — проходит", async (t) => {
  tishina(t);
  assert.equal(BODY_MAX, 2 * 1024 * 1024);
  // Как у сервера (server.js): общий предел 55 МБ; 2 МБ для этого маршрута задаёт сам маршрут
  const app = Fastify({ bodyLimit: 55 * 1024 * 1024 });
  const propuski = [];
  const vyzovy = [];
  registerPdfSmetHtmlRoute(app, {
    propusk: async (request) => { propuski.push(request.url); return { id: "polzovatel" }; },
    pechatat: async (html) => { vyzovy.push(html); return PDF; },
  });
  t.after(() => app.close());
  const otpravit1 = (payload) => app.inject({ method: "POST", url: URL_MARSHRUTA, headers: { authorization: TOKEN }, payload });

  const bolshoy = await otpravit1({ html: dokument({ razmer: BODY_MAX }) });
  assert.equal(bolshoy.statusCode, 413);
  assert.equal(propuski.length, 0);
  assert.equal(vyzovy.length, 0);
  const ochenBolshoy = await otpravit1({ html: dokument({ razmer: 6 * 1024 * 1024 }) });
  assert.equal(ochenBolshoy.statusCode, 413);
  assert.equal(propuski.length, 0);

  const pochti = await otpravit1({ html: dokument({ razmer: BODY_MAX - 2048 }) });
  assert.equal(pochti.statusCode, 200);
  assert.equal(propuski.length, 1);
  assert.equal(vyzovy.length, 1);
});

test("печать упала — 502 словами, без текста ошибки и путей, полный текст — в console.error; следующий запрос проходит", async (t) => {
  const log = [];
  t.mock.method(console, "log", (...args) => { log.push(args.map(String).join(" ")); });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", (...args) => { log.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")); });
  const TEKST = "spawn /tmp/chromium ENOENT\n    at ChildProcess._handle.onexit (node:internal/child_process:285:19)";
  let vyzov = 0;
  const { app } = await sobrat(t, {
    pechatat: async () => { if (++vyzov === 1) throw new Error(TEKST); return PDF; },
  });

  const upal = await otpravit(app, { html: dokument() });
  assert.equal(upal.statusCode, 502);
  assert.equal(upal.json().error, "PDF generation failed");
  assert.match(upal.json().details, /Не удалось напечатать PDF/);
  assert.doesNotMatch(upal.payload, /tmp\/chromium|ENOENT|child_process/);
  assert.ok(log.some((l) => l.includes(TEKST)), "полного текста ошибки нет в console.error");

  assert.equal((await otpravit(app, { html: dokument() })).statusCode, 200);
  // В журнал идут размеры, а не документ: имя клиента из html нигде не напечатано
  assert.ok(log.length >= 2);
  for (const l of log) assert.doesNotMatch(l, /Иванов/, "текст документа попал в журнал");
  assert.ok(log.some((l) => /напечатан документ CRM: html \d+ байт, pdf \d+ байт, \d+ мс/.test(l)));
});

test("печать занята — 503 и Retry-After: 60", async (t) => {
  tishina(t);
  const { app } = await sobrat(t, { pechatat: async () => { throw new PechatZanyata(); } });
  const res = await otpravit(app, { html: dokument() });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers["retry-after"], "60");
  assert.equal(res.json().error, "Print queue is full");
  assert.match(res.json().details, /Печать занята, повторите через минуту/);
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

// POST документ по настоящему сокету; req.destroy() — клиент рвёт соединение. otvet — {status, body} или "oborvano"
function prosba(port, payload) {
  const tekst = JSON.stringify(payload);
  let req;
  const otvet = new Promise((resolve) => {
    req = http.request({
      host: "127.0.0.1", port, method: "POST", path: URL_MARSHRUTA, agent: false,
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

test("клиент ушёл, пока печать занята другим: второй документ не печатают, Chrome не запускают, ответа нет, место свободно", async (t) => {
  const zhurnal = [];
  t.mock.method(console, "log", (...args) => { zhurnal.push(args.join(" ")); });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});

  // Подставной Chrome и печать: печать стоит, пока тест не отпустит её
  const s = { zapuskov: 0, zakryto: 0, napechatano: [], zhdut: [] };
  const pechatnik = sozdatPechatnika({
    zapustit: async () => { s.zapuskov++; return { close: async () => { s.zakryto++; }, process: () => null }; },
    pechatat: async () => { throw new Error("печатник по умолчанию не должен звать"); },
    srok: 5000,
  });
  const strogiy = async (browser, html) => { s.napechatano.push(html); await new Promise((r) => { s.zhdut.push(r); }); return Buffer.from("%PDF-подмена"); };
  const voshli = []; // html, с которыми маршрут позвал печатника (в том числе ждущие места)
  const app = Fastify();
  registerPdfSmetHtmlRoute(app, {
    propusk: propuskPoZagolovku,
    // Своя страница документа подменена подставной: маршрут отдаёт очереди pechatatDokument, здесь вместо неё — strogiy
    pechatat: (html, opts) => { voshli.push(html); assert.equal(opts.pechatat, pechatatDokument); return pechatnik(html, { ...opts, pechatat: strogiy }); },
  });
  t.after(() => app.close());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = app.server.address().port;
  const dok = (n) => ({ html: dokument({ telo: `Клиент ${n}` }) });

  const pervyy = prosba(port, dok("#1"));
  await dozhdatsya(() => s.zhdut.length === 1, "первая печать стоит");
  const vtoroy = prosba(port, dok("#2"));
  await dozhdatsya(() => voshli.length === 2, "второй документ ждёт места");

  // Клиент рвёт соединение, пока печать занята первым
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
  await dozhdatsya(() => zhurnal.some((l) => /клиент ушёл/.test(l)), "route-html.js увидел, что клиент ушёл");

  assert.equal(s.napechatano.length, 1, "подставная печать вызвана не один раз");
  assert.match(s.napechatano[0], /Клиент #1/);
  assert.equal(s.zapuskov, 1, "Chrome запускали для ушедшего клиента");
  assert.equal(s.zakryto, 1);

  // Место свободно: следующий документ печатается
  const tretiy = prosba(port, dok("#3"));
  await dozhdatsya(() => s.zhdut.length === 1, "третья печать стоит");
  s.zhdut.shift()();
  assert.equal((await tretiy.otvet).status, 200);
  assert.equal(s.napechatano.length, 2);
  assert.match(s.napechatano[1], /Клиент #3/);
});

// --- CORS: общий плагин сервера (server.js: origin '*', GET, POST, OPTIONS) закрывает и новый маршрут ---

test("CORS как на сервере: preflight с Authorization и Content-Type от CRM и от localhost — 204 и разрешён POST; ответ POST несёт access-control-allow-origin", async (t) => {
  tishina(t);
  const app = Fastify();
  // Те же параметры, что в server.js: fastify.register(require('@fastify/cors'), { origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }), маршруты — после
  await app.register(require("@fastify/cors"), { origin: "*", methods: ["GET", "POST", "OPTIONS"] });
  registerPdfSmetHtmlRoute(app, { propusk: propuskPoZagolovku, pechatat: async () => PDF });
  t.after(() => app.close());

  for (const origin of ["https://sunray-crm.ru", "http://localhost:8087", "http://localhost:5173"]) {
    const pre = await app.inject({
      method: "OPTIONS", url: URL_MARSHRUTA,
      headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.equal(pre.statusCode, 204, origin);
    assert.equal(pre.headers["access-control-allow-origin"], "*", origin);
    assert.match(pre.headers["access-control-allow-methods"], /POST/, origin);
    const razresheno = String(pre.headers["access-control-allow-headers"]).toLowerCase();
    assert.ok(razresheno.includes("authorization") && razresheno.includes("content-type"), `${origin}: заголовки не разрешены: ${razresheno}`);

    const res = await app.inject({ method: "POST", url: URL_MARSHRUTA, headers: { origin, authorization: TOKEN }, payload: { html: dokument() } });
    assert.equal(res.statusCode, 200, origin);
    assert.equal(res.headers["access-control-allow-origin"], "*", origin);
  }
  // Отказы тоже с CORS: браузер CRM увидит 401, а не «сетевую ошибку»
  const bez = await app.inject({ method: "POST", url: URL_MARSHRUTA, headers: { origin: "https://sunray-crm.ru" }, payload: { html: dokument() } });
  assert.equal(bez.statusCode, 401);
  assert.equal(bez.headers["access-control-allow-origin"], "*");
});

// --- сборка целиком: маршрут → настоящая очередь печатника → страница документа (pechatatDokument) на подставном Chrome ---

test("сборка: очередь печатника получает pechatatDokument — JS выключен, перехват до setContent, Storage закрыт, шрифты Google открыты, PDF возвращается как есть", async (t) => {
  tishina(t);
  const zhurnal = [];
  const reshenie = [];
  const optsPdf = [];
  let obrabotchik = null;
  const stranica = {
    setJavaScriptEnabled: async (vkl) => { zhurnal.push(`js:${vkl}`); },
    setRequestInterception: async (vkl) => { zhurnal.push(`perehvat:${vkl}`); },
    on: (imya, f) => { if (imya === "request") obrabotchik = f; },
    setContent: async (html, opts) => {
      zhurnal.push(`setContent:${opts.waitUntil}`);
      // Страница «просит» адреса прямо во время загрузки, как настоящая
      for (const url of ["https://fonts.googleapis.com/css2?family=Montserrat", `${SUPABASE_URL}/storage/v1/object/public/x.png`, "http://127.0.0.1:9/x"]) {
        obrabotchik({
          url: () => url, isInterceptResolutionHandled: () => false,
          continue: async () => { reshenie.push(`continue ${url}`); }, abort: async (kod) => { reshenie.push(`abort ${kod} ${url}`); },
        });
      }
    },
    evaluate: async () => { zhurnal.push("evaluate"); },
    pdf: async (opts) => { zhurnal.push("pdf"); optsPdf.push(opts); return new Uint8Array(PDF); },
    close: async () => { zhurnal.push("close"); },
  };
  const brauzer = { newPage: async () => stranica, close: async () => { zhurnal.push("chrome-close"); }, process: () => null };
  const zapuski = [];
  const pechatnik = sozdatPechatnika({
    zapustit: async (opcii) => { zapuski.push(opcii); return brauzer; },
    pechatat: async () => { throw new Error("печатник сметы позван вместо печатника документа"); },
    srok: 3000,
  });
  const { app } = await sobrat(t, { pechatat: pechatnik });
  const res = await otpravit(app, { html: dokument() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.rawPayload, PDF);
  assert.deepEqual(zhurnal, ["js:false", "perehvat:true", "setContent:networkidle0", "evaluate", "pdf", "close", "chrome-close"]);
  await tik();
  assert.deepEqual(reshenie, [
    "continue https://fonts.googleapis.com/css2?family=Montserrat",
    `abort blockedbyclient ${SUPABASE_URL}/storage/v1/object/public/x.png`,
    "abort blockedbyclient http://127.0.0.1:9/x",
  ]);
  assert.equal(optsPdf[0].preferCSSPageSize, true);
  assert.equal(optsPdf[0].printBackground, true);
  assert.equal(optsPdf[0].timeout, 3000, "срок печати не тот, что у очереди");
  // Запуск Chrome: срок очереди и запрет сети кроме шрифтов Google
  assert.deepEqual(zapuski, [{ srok: 3000, argumenty: ARGUMENTY_ZAPRET_SETI }]);
});

test("server.js подключает маршрут документа CRM сразу после маршрута сметы, после CORS", () => {
  const tekst = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const cors = tekst.indexOf("require('@fastify/cors')");
  const smeta = tekst.indexOf('require("./pdf-smet/route").registerPdfSmetRoute(fastify);');
  const dokumentCrm = tekst.indexOf('require("./pdf-smet/route-html").registerPdfSmetHtmlRoute(fastify);');
  assert.ok(cors > 0 && smeta > cors && dokumentCrm > smeta, `порядок подключения нарушен: cors ${cors}, смета ${smeta}, документ ${dokumentCrm}`);
});
