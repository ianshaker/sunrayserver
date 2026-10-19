"use strict";

// Печать страницы сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква А/Б, дыра 5): белый список адресов razreshenAdres и защита
// страницы — JS выключен, перехват запросов включён до загрузки HTML. Настоящий Chrome не запускается: браузер и страница подменены.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/pechat.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { pechatatPdf, razreshenAdres } = require("./pechat");
const { SUPABASE_URL, buildHtml, dozapolnitPozicii } = require("./shablon");

// Шумит console.warn печати (заблокированный адрес) — в тесте заглушаем
function tishina(t) {
  for (const imya of ["log", "error", "warn"]) t.mock.method(console, imya, () => {});
}
const tik = () => new Promise((resolve) => setImmediate(resolve));

// --- защита страницы сметы (pechat.js, дыра 5): JS выключен, запросы только к своим адресам ---

test("razreshenAdres: data:, шрифты Google и публичный Storage нашего Supabase — можно, остальное — нельзя", () => {
  const mozhno = [
    "data:image/png;base64,AAAA",
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=block",
    "https://fonts.gstatic.com/s/montserrat/v26/x.woff2",
    `${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/stamp.webp`,
  ];
  const nelzya = [
    "http://127.0.0.1:9/x.png",
    "http://169.254.169.254/latest/meta-data/",
    "https://evil.example/x.png",
    "file:///etc/passwd",
    "ftp://fonts.googleapis.com/x",
    "http://fonts.googleapis.com/css2",
    "https://fonts.googleapis.com.evil.example/css2",
    "https://fonts.googleapis.com@evil.example/css2",
    `${SUPABASE_URL}/rest/v1/estimates`,
    `${SUPABASE_URL}/storage/v1/object/sign/x?token=1`,
    `${SUPABASE_URL}.evil.example/storage/v1/object/public/x.png`,
    "https://other-project.supabase.co/storage/v1/object/public/x.png",
    "ne-adres",
    "",
  ];
  for (const adres of mozhno) assert.equal(razreshenAdres(adres), true, adres);
  for (const adres of nelzya) assert.equal(razreshenAdres(adres), false, adres);
  assert.equal(razreshenAdres("https://own.supabase.co/storage/v1/object/public/a.png", "https://own.supabase.co"), true);
  assert.equal(razreshenAdres(`${SUPABASE_URL}/storage/v1/object/public/a.png`, "https://own.supabase.co"), false);
});

// Подставная страница: пишет вызовы по порядку и отдаёт тесту обработчик запросов
function podmenaStranicy({ pdfPadaet = false } = {}) {
  const zhurnal = [];
  const reshenie = [];
  const optsPdf = []; // с какими опциями звали page.pdf
  let obrabotchik = null;
  const stranica = {
    setJavaScriptEnabled: async (vkl) => { zhurnal.push(`js:${vkl}`); },
    setRequestInterception: async (vkl) => { zhurnal.push(`perehvat:${vkl}`); },
    on: (imya, f) => { if (imya === "request") obrabotchik = f; },
    setContent: async () => { zhurnal.push("setContent"); },
    evaluate: async () => { zhurnal.push("evaluate"); },
    pdf: async (opts) => { zhurnal.push("pdf"); optsPdf.push(opts); if (pdfPadaet) throw new Error("pdf упал"); return new Uint8Array([37, 80, 68, 70]); },
    close: async () => { zhurnal.push("close"); },
  };
  const zapros = (url) => obrabotchik({
    url: () => url,
    isInterceptResolutionHandled: () => false,
    continue: async () => { reshenie.push(`continue ${url}`); },
    abort: async (kod) => { reshenie.push(`abort ${kod} ${url}`); },
  });
  return { browser: { newPage: async () => stranica }, zhurnal, reshenie, zapros, optsPdf };
}

test("страница сметы: JS и перехват включаются до загрузки HTML, чужой адрес — abort, свой — continue", async (t) => {
  tishina(t);
  const p = podmenaStranicy();
  const pdf = await pechatatPdf(p.browser, "<html></html>", { timeout: 1000 });
  assert.deepEqual(pdf, Buffer.from("%PDF"));
  assert.deepEqual(p.zhurnal.slice(0, 3), ["js:false", "perehvat:true", "setContent"]);
  p.zapros("http://127.0.0.1:9/x.png");
  p.zapros("https://fonts.googleapis.com/css2?family=Montserrat");
  p.zapros(`${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/stamp.webp`);
  await tik();
  assert.deepEqual(p.reshenie, [
    "abort blockedbyclient http://127.0.0.1:9/x.png",
    "continue https://fonts.googleapis.com/css2?family=Montserrat",
    `continue ${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/stamp.webp`,
  ]);
  assert.equal(p.zhurnal.at(-1), "close");
});

test("страница сметы закрывается и когда печать упала", async (t) => {
  tishina(t);
  const p = podmenaStranicy({ pdfPadaet: true });
  await assert.rejects(pechatatPdf(p.browser, "<html></html>", { timeout: 1000 }), /pdf упал/);
  assert.equal(p.zhurnal.at(-1), "close");
});

// --- печать листа A5: размер, поля и подвал берёт сам шаблон из @page ---

test("опции печати: preferCSSPageSize и фон есть, format (width, height) нет — лист 420×595 pt задаёт @page шаблона; поля нулевые", async (t) => {
  tishina(t);
  const p = podmenaStranicy();
  await pechatatPdf(p.browser, "<html></html>", { timeout: 1234 });
  assert.equal(p.optsPdf.length, 1);
  const opts = p.optsPdf[0];
  assert.equal(opts.preferCSSPageSize, true);
  assert.equal(opts.printBackground, true);
  assert.deepEqual(opts.margin, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(opts.timeout, 1234);
  for (const lishnee of ["format", "width", "height", "landscape"]) assert.ok(!(lishnee in opts), `в опциях печати есть ${lishnee}`);
  // Шаблон и печать согласованы: размер листа стоит в @page шаблона, а не в опциях
  const html = buildHtml({ clientData: { appealId: "#1" }, items: dozapolnitPozicii([{ productLabel: "Штора", quantity: 1, price: 1000 }]) });
  assert.match(html, /@page \{\s*size: 420pt 595pt;/);
});

// Адреса, которые страница сметы грузит сама: <img src>, <link href> (шрифты) и url(...) в стилях; ссылки <a href> не грузятся
function adresaStranicy(html) {
  const adresa = [
    ...[...html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g)].map((m) => m[1]).filter((a) => !a.startsWith("#")),
  ];
  return adresa.map((a) => a.replace(/&amp;/g, "&"));
}

test("страница сметы просит только разрешённые адреса: логотип — data:, шрифты — Google; Storage, чужих адресов и адреса из headerImageUrl нет", () => {
  const body = {
    clientData: { appealId: "#09784", clientName: "Тест Тестов", phone: "8(900)000-00-00", city: "Химки", address: "ул. Тестовая, 1" },
    headerImageUrl: "https://evil.example/cover.png",
    items: dozapolnitPozicii([{ productLabel: "Штора", materialName: "Ткань", quantity: 1, price: 1000 }]),
    montage: { mode: "sum", amount: 500 }, promoDiscount: 10, vatIncluded5: true, validUntil: "2026-10-22", createdDay: "2026-10-08", printDay: "2026-10-17",
  };
  const html = buildHtml(body);
  const adresa = adresaStranicy(html);
  assert.ok(adresa.length >= 4, `адресов слишком мало: ${adresa.length}`);
  for (const adres of adresa) assert.equal(razreshenAdres(adres), true, adres.slice(0, 100));
  assert.ok(adresa.some((a) => a.startsWith("data:image/png;base64,")), "логотипа data: нет");
  // Только data: и два хоста Google Fonts: печати компании в смете больше нет, поэтому обращений к Storage нет
  const istochniki = new Set(adresa.map((a) => (a.startsWith("data:") ? "data:" : new URL(a).host)));
  assert.deepEqual([...istochniki].sort(), ["data:", "fonts.googleapis.com", "fonts.gstatic.com"]);
  // Любые абсолютные адреса в тексте страницы, в том числе ссылки <a href> (они не грузятся): шрифты Google, Storage нашего Supabase, сайт компании в реквизитах
  const dopustimye = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "zhalyuzi-sunray.ru", new URL(SUPABASE_URL).host]);
  const vse = [...html.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)].map((m) => m[0]);
  assert.ok(vse.length >= 3, `абсолютных адресов слишком мало: ${vse.length}`);
  for (const adres of vse) assert.ok(dopustimye.has(new URL(adres).host), adres.slice(0, 100));
  assert.ok(!adresa.some((a) => a.includes("evil.example")));
});
