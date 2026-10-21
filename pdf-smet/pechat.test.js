"use strict";

// Печать страницы сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква А/Б, дыра 5): белый список адресов razreshenAdres и защита
// страницы — JS выключен, перехват запросов включён до загрузки HTML. Настоящий Chrome не запускается: браузер и страница подменены.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/pechat.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { pechatatPdf, pechatatDokument, razreshenAdres, razreshenAdresDokumenta, ARGUMENTY_ZAPRET_SETI } = require("./pechat");
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
  const setContentVyzovy = []; // с чем звали page.setContent: { html, opts }
  let obrabotchik = null;
  const stranica = {
    setJavaScriptEnabled: async (vkl) => { zhurnal.push(`js:${vkl}`); },
    setRequestInterception: async (vkl) => { zhurnal.push(`perehvat:${vkl}`); },
    on: (imya, f) => { if (imya === "request") obrabotchik = f; },
    setContent: async (html, opts) => { zhurnal.push("setContent"); setContentVyzovy.push({ html, opts }); },
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
  return { browser: { newPage: async () => stranica }, zhurnal, reshenie, zapros, optsPdf, setContentVyzovy };
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

// Город объекта (20.10.2026): строка сайта в реквизитах ведёт на поддомен города. Это <a href> — страница её не грузит, и белый список печати (razreshenAdres) сайт компании не пускает.
// Тест выше (допустим только точный zhalyuzi-sunray.ru) не тронут; здесь — страницы с городом во всех трёх форматах.
test("страница сметы с городом объекта (поддомен) во всех трёх форматах просит те же разрешённые адреса; абсолютные адреса в тексте — шрифты Google, Storage Supabase, zhalyuzi-sunray.ru или его поддомен", () => {
  const body = {
    clientData: { appealId: "#09784", clientName: "Тест Тестов", phone: "8(900)000-00-00", city: "Химки", address: "ул. Тестовая, 1" },
    headerImageUrl: "https://evil.example/cover.png",
    items: dozapolnitPozicii([{ productLabel: "Штора", materialName: "Ткань", quantity: 1, price: 1000 }, { productLabel: "Жалюзи", quantity: 2, price: 2500 }]),
    montage: { mode: "sum", amount: 500 }, promoDiscount: 10, vatIncluded5: true, validUntil: "2026-10-22", createdDay: "2026-10-08", printDay: "2026-10-17",
  };
  const gorod = { name: "Истра", siteHost: "istra.zhalyuzi-sunray.ru" };
  const hostSupabase = new URL(SUPABASE_URL).host;
  const dopustimyHost = (host) => host === "fonts.googleapis.com" || host === "fonts.gstatic.com" || host === hostSupabase
    || host === "zhalyuzi-sunray.ru" || host.endsWith(".zhalyuzi-sunray.ru");
  for (const sheet of ["big", "compact", "pc"]) {
    const bez = buildHtml({ ...body, sheet });
    const html = buildHtml({ ...body, sheet, cityContext: gorod });
    const adresa = adresaStranicy(html);
    assert.ok(adresa.length >= 4, `${sheet}: адресов слишком мало: ${adresa.length}`);
    // страница просит ровно то, что просила без города, и всё это пускает razreshenAdres
    assert.deepEqual(adresa, adresaStranicy(bez), `${sheet}: город добавил адреса для загрузки`);
    for (const adres of adresa) assert.equal(razreshenAdres(adres), true, `${sheet}: ${adres.slice(0, 100)}`);
    assert.deepEqual([...new Set(adresa.map((a) => (a.startsWith("data:") ? "data:" : new URL(a).host)))].sort(), ["data:", "fonts.googleapis.com", "fonts.gstatic.com"], sheet);
    // любые абсолютные адреса в тексте (в том числе ссылка <a href> сайта города, она не грузится)
    const vse = [...html.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)].map((m) => m[0]);
    assert.ok(vse.length >= 3, `${sheet}: абсолютных адресов слишком мало: ${vse.length}`);
    for (const adres of vse) assert.ok(dopustimyHost(new URL(adres).hostname), `${sheet}: ${adres.slice(0, 100)}`);
    assert.ok(vse.includes("https://istra.zhalyuzi-sunray.ru/"), `${sheet}: ссылки на сайт города нет`);
    assert.ok(!html.includes("evil.example"), `${sheet}: адрес из headerImageUrl попал в страницу`);
  }
  // сайт компании печатающему Chrome не нужен и не разрешён: ссылку в реквизитах страница не грузит
  assert.equal(razreshenAdres("https://istra.zhalyuzi-sunray.ru/"), false);
  assert.equal(razreshenAdres("https://zhalyuzi-sunray.ru/"), false);
  // чужой хост и ссылка в имени города — не адреса для загрузки: страница просит то же, что без города, чужого хоста в ней нет
  for (const sheet of ["big", "compact", "pc"]) {
    const bez = adresaStranicy(buildHtml({ ...body, sheet }));
    const podmena = buildHtml({ ...body, sheet, cityContext: { name: "Истра", siteHost: "evil.example/x.png" } });
    assert.ok(!podmena.includes("evil.example"), `${sheet}: чужой хост попал в страницу`);
    assert.deepEqual(adresaStranicy(podmena), bez, sheet);
    const sSylkoy = buildHtml({ ...body, sheet, cityContext: { name: "https://evil.example/x.png" } });
    assert.deepEqual(adresaStranicy(sSylkoy), bez, `${sheet}: ссылка в имени города стала адресом загрузки`);
  }
});

// --- документ CRM (POST /api/pdf/smeta-html, route-html.js): та же страница, что у сметы, но белый список адресов строже ---

test("razreshenAdresDokumenta: data:, about:blank и шрифты Google — можно; Storage Supabase, file:, localhost, чужие хосты и порты, не-https — нельзя", () => {
  const mozhno = [
    "data:image/png;base64,AAAA",
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>",
    "data:font/woff2;base64,AAAA",
    "about:blank",
    "https://fonts.googleapis.com/",
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=block",
    "https://fonts.gstatic.com/s/montserrat/v26/x.woff2",
    "https://fonts.googleapis.com:443/css2",
    "HTTPS://FONTS.GOOGLEAPIS.COM/css2",
  ];
  const nelzya = [
    // Storage Supabase: смете можно (razreshenAdres), документу CRM — нет: он самодостаточный
    `${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/stamp.webp`,
    // файлы, localhost, внутренние адреса и метаданные облака
    "file:///etc/passwd", "file://localhost/etc/passwd",
    "http://localhost/x", "http://localhost:3000/x", "https://localhost/x", "http://127.0.0.1:9/x.png", "https://127.0.0.1/x",
    "http://[::1]/x", "http://0.0.0.0/", "http://10.0.0.5/", "http://169.254.169.254/latest/meta-data/", "http://internal.host:10000/ping",
    // шрифты Google, но не по https, не на своём порту, с логином или на чужом хосте
    "http://fonts.googleapis.com/css2", "http://fonts.gstatic.com/s/x.woff2",
    "https://fonts.googleapis.com:8443/css2", "https://fonts.googleapis.com:25/", "https://fonts.gstatic.com:80/x",
    "https://user:pass@fonts.googleapis.com/css2", "https://user@fonts.gstatic.com/x",
    "https://fonts.googleapis.com@evil.example/css2", "https://fonts.googleapis.com.evil.example/css2", "https://evilfonts.googleapis.com/css2",
    "https://fonts.gstatic.com.evil.example/x", "https://evil.example/fonts.googleapis.com/css2",
    "https://googleapis.com/", "https://www.google.com/", "https://fonts.google.com/", "https://evil.example/x.png",
    // другие протоколы
    "ws://fonts.googleapis.com/", "wss://fonts.googleapis.com/", "ftp://fonts.googleapis.com/x", "blob:https://fonts.googleapis.com/0000",
    "filesystem:https://fonts.googleapis.com/temporary/x", "javascript:alert(1)", "chrome://version", "chrome-extension://abc/x",
    "about:srcdoc", "about:blank#x", "about:blank?x", "about:",
    // не адреса
    "ne-adres", "", " ", undefined, null, 42, {},
  ];
  for (const adres of mozhno) assert.equal(razreshenAdresDokumenta(adres), true, String(adres));
  for (const adres of nelzya) assert.equal(razreshenAdresDokumenta(adres), false, String(adres));
  // у сметы список прежний: Storage своего Supabase пускается, about:blank — нет (документ CRM строже только по Storage и мягче на about:blank)
  assert.equal(razreshenAdres(`${SUPABASE_URL}/storage/v1/object/public/a.png`), true);
  assert.equal(razreshenAdres("about:blank"), false);
});

test("документ CRM: страница та же — JS и перехват до setContent, ждём сеть и шрифты, опции печати как у сметы; адреса — только строгий список", async (t) => {
  tishina(t);
  const html = "<html><style>@page { size: 420pt 595pt }</style></html>";
  const doc = podmenaStranicy();
  const pdf = await pechatatDokument(doc.browser, html, { timeout: 4321 });
  assert.deepEqual(pdf, Buffer.from("%PDF"));
  assert.deepEqual(doc.zhurnal, ["js:false", "perehvat:true", "setContent", "evaluate", "pdf", "close"]);
  assert.equal(doc.setContentVyzovy.length, 1);
  assert.equal(doc.setContentVyzovy[0].html, html, "документ изменён по дороге");
  assert.deepEqual(doc.setContentVyzovy[0].opts, { waitUntil: "networkidle0", timeout: 4321 });

  // Печать и опции — те же, что у сметы: лист и поля из @page, фон есть, колонтитулов и своего format нет
  const smeta = podmenaStranicy();
  await pechatatPdf(smeta.browser, html, { timeout: 4321 });
  assert.deepEqual(doc.optsPdf, smeta.optsPdf);
  const opts = doc.optsPdf[0];
  assert.equal(opts.preferCSSPageSize, true);
  assert.equal(opts.printBackground, true);
  assert.deepEqual(opts.margin, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(opts.timeout, 4321);
  for (const lishnee of ["format", "width", "height", "landscape", "displayHeaderFooter", "headerTemplate", "footerTemplate", "scale", "pageRanges"]) {
    assert.ok(!(lishnee in opts), `в опциях печати есть ${lishnee}`);
  }

  // Адреса: шрифты Google, data: и about:blank — continue; Storage Supabase (смете можно), file:, localhost, чужое — abort
  const storage = `${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/stamp.webp`;
  const adresa = [
    "https://fonts.googleapis.com/css2?family=Montserrat", "https://fonts.gstatic.com/s/montserrat/x.woff2", "data:image/png;base64,AAAA", "about:blank",
    storage, "file:///etc/passwd", "http://localhost:3000/x", "http://127.0.0.1:9/x.png", "https://evil.example/x.png",
  ];
  for (const adres of adresa) doc.zapros(adres);
  await tik();
  assert.deepEqual(doc.reshenie, [
    "continue https://fonts.googleapis.com/css2?family=Montserrat",
    "continue https://fonts.gstatic.com/s/montserrat/x.woff2",
    "continue data:image/png;base64,AAAA",
    "continue about:blank",
    `abort blockedbyclient ${storage}`,
    "abort blockedbyclient file:///etc/passwd",
    "abort blockedbyclient http://localhost:3000/x",
    "abort blockedbyclient http://127.0.0.1:9/x.png",
    "abort blockedbyclient https://evil.example/x.png",
  ]);
  // У сметы Storage по-прежнему открыт (правка pechatatPdf ничего не поменяла)
  for (const adres of [storage, "http://localhost:3000/x"]) smeta.zapros(adres);
  await tik();
  assert.deepEqual(smeta.reshenie, [`continue ${storage}`, "abort blockedbyclient http://localhost:3000/x"]);
});

test("документ CRM: страница закрывается и когда печать упала; без timeout берётся 30 с по умолчанию", async (t) => {
  tishina(t);
  const upala = podmenaStranicy({ pdfPadaet: true });
  await assert.rejects(pechatatDokument(upala.browser, "<html></html>", { timeout: 1000 }), /pdf упал/);
  assert.equal(upala.zhurnal.at(-1), "close");

  const bez = podmenaStranicy();
  await pechatatDokument(bez.browser, "<html></html>");
  assert.deepEqual(bez.setContentVyzovy[0].opts, { waitUntil: "networkidle0", timeout: 30000 });
  assert.equal(bez.optsPdf[0].timeout, 30000);
});

test("ARGUMENTY_ZAPRET_SETI: всё уходит на глухой прокси, в обход — ровно шрифты Google, localhost и 127.0.0.1 не обходятся", () => {
  assert.deepEqual(ARGUMENTY_ZAPRET_SETI, ["--proxy-server=socks5://127.0.0.1:1", "--proxy-bypass-list=fonts.googleapis.com;fonts.gstatic.com;<-loopback>"]);
  // Хосты в обход прокси — те же, что пускает razreshenAdresDokumenta; «<-loopback>» снимает обход прокси для loopback
  const obhod = ARGUMENTY_ZAPRET_SETI[1].split("=")[1].split(";");
  assert.ok(obhod.includes("<-loopback>"), "обход прокси для localhost не снят");
  const hosty = obhod.filter((x) => !x.startsWith("<"));
  assert.equal(hosty.length, 2);
  for (const host of hosty) assert.equal(razreshenAdresDokumenta(`https://${host}/x`), true, host);
});
