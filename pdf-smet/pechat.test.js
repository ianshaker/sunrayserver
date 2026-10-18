"use strict";

// Печать страницы сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква А/Б, дыра 5): белый список адресов razreshenAdres и защита
// страницы — JS выключен, перехват запросов включён до загрузки HTML. Настоящий Chrome не запускается: браузер и страница подменены.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/pechat.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { pechatatPdf, razreshenAdres } = require("./pechat");
const { SUPABASE_URL } = require("./shablon");

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
  let obrabotchik = null;
  const stranica = {
    setJavaScriptEnabled: async (vkl) => { zhurnal.push(`js:${vkl}`); },
    setRequestInterception: async (vkl) => { zhurnal.push(`perehvat:${vkl}`); },
    on: (imya, f) => { if (imya === "request") obrabotchik = f; },
    setContent: async () => { zhurnal.push("setContent"); },
    evaluate: async () => { zhurnal.push("evaluate"); },
    pdf: async () => { zhurnal.push("pdf"); if (pdfPadaet) throw new Error("pdf упал"); return new Uint8Array([37, 80, 68, 70]); },
    close: async () => { zhurnal.push("close"); },
  };
  const zapros = (url) => obrabotchik({
    url: () => url,
    isInterceptResolutionHandled: () => false,
    continue: async () => { reshenie.push(`continue ${url}`); },
    abort: async (kod) => { reshenie.push(`abort ${kod} ${url}`); },
  });
  return { browser: { newPage: async () => stranica }, zhurnal, reshenie, zapros };
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
