"use strict";

// Маршрут POST /api/pdf/smeta без Chrome (PLANS/SERVER/05-pdf-smet, буква Б): пропуск, 400, ответ и имя файла, 502, 503,
// очередь печатника, защита страницы сметы. Настоящий Chrome здесь не запускается: печать и браузер подменены.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/route.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { registerPdfSmetRoute, zagolovokFayla } = require("./route");
const { sozdatPechatnika, PechatZanyata } = require("./brauzer");
const { pechatatPdf, razreshenAdres } = require("./pechat");
const { SUPABASE_URL } = require("./shablon");

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
  assert.match(upal.json().details, /Не удалось напечатать PDF: Chrome упал на старте/);
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

// --- очередь печатника (brauzer.js): подставной запуск и печать, настоящего Chrome нет ---

function podmenaChrome() {
  const sostoyanie = { zakryto: 0, zapuskov: 0, aktivno: 0, maxAktivno: 0, poryadok: [], zhdut: [] };
  sostoyanie.zapustit = async () => {
    sostoyanie.zapuskov++;
    return { close: async () => { sostoyanie.zakryto++; }, process: () => null };
  };
  // Печать стоит, пока тест не вызовет otpustit(); html возвращается как PDF
  sostoyanie.pechatat = async (browser, html) => {
    sostoyanie.aktivno++;
    sostoyanie.maxAktivno = Math.max(sostoyanie.maxAktivno, sostoyanie.aktivno);
    sostoyanie.poryadok.push(html);
    await new Promise((resolve) => { sostoyanie.zhdut.push(resolve); });
    sostoyanie.aktivno--;
    return Buffer.from(html);
  };
  return sostoyanie;
}
const tik = () => new Promise((resolve) => setImmediate(resolve));
const spat = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("очередь: печатает один, пять ждут по порядку, седьмой получает отказ; Chrome закрыт после каждой печати", async () => {
  const s = podmenaChrome();
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, maxZhdut: 5, srok: 5000 });
  const zaprosy = [0, 1, 2, 3, 4, 5, 6].map((n) => pechatat(String(n)).then((pdf) => pdf.toString(), (e) => e));
  await tik();
  await tik();
  // Седьмой (номер 6): одна печать идёт, пять ждут — места нет
  assert.ok((await zaprosy[6]) instanceof PechatZanyata);
  assert.equal((await zaprosy[6]).code, "PECHAT_ZANYATA");
  assert.equal(s.aktivno, 1);
  for (let i = 0; i < 6; i++) {
    while (s.zhdut.length === 0) await tik();
    s.zhdut.shift()();
    await tik();
  }
  assert.deepEqual(await Promise.all(zaprosy.slice(0, 6)), ["0", "1", "2", "3", "4", "5"]);
  assert.deepEqual(s.poryadok, ["0", "1", "2", "3", "4", "5"]);
  assert.equal(s.maxAktivno, 1);
  assert.equal(s.zapuskov, 6);
  assert.equal(s.zakryto, 6);
  // Очередь свободна: следующая печать идёт сразу
  const eshche = pechatat("7");
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  assert.equal((await eshche).toString(), "7");
});

test("очередь: печать не уложилась в срок — ошибка словами, Chrome закрыт, очередь свободна", async () => {
  const s = podmenaChrome();
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, srok: 60 });
  await assert.rejects(pechatat("висит"), /печать не уложилась в 0\.06 с/);
  assert.equal(s.zakryto, 1);
  const sleduyushchaya = pechatat("следом");
  while (s.zhdut.length < 2) await tik();
  s.zhdut.pop()();
  assert.equal((await sleduyushchaya).toString(), "следом");
  s.zhdut.shift()();
});

test("очередь: Chrome запустился позже срока — его всё равно закрывают", async () => {
  const s = podmenaChrome();
  const pozdno = async () => { await spat(150); return s.zapustit(); };
  const pechatat = sozdatPechatnika({ zapustit: pozdno, pechatat: s.pechatat, srok: 40 });
  await assert.rejects(pechatat("поздно"), /печать не уложилась/);
  await spat(250);
  assert.equal(s.zapuskov, 1);
  assert.equal(s.zakryto, 1);
  assert.equal(s.poryadok.length, 0);
});

test("очередь: печать упала — Chrome закрыт, ошибка дошла, следующая печать идёт", async () => {
  const s = podmenaChrome();
  let vyzov = 0;
  const pechatat = sozdatPechatnika({
    zapustit: s.zapustit,
    pechatat: async (browser, html) => { if (++vyzov === 1) throw new Error("страница упала"); return Buffer.from(html); },
    srok: 5000,
  });
  await assert.rejects(pechatat("a"), /страница упала/);
  assert.equal(s.zakryto, 1);
  assert.equal((await pechatat("b")).toString(), "b");
  assert.equal(s.zakryto, 2);
});

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
