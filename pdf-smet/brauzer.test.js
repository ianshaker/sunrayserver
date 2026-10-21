"use strict";

// Очередь печатника без Chrome (PLANS/SERVER/05-pdf-smet, буква Б): порядок и отказ, срок ожидания, «клиент ушёл», срок печати,
// принудительное закрытие зависшего Chrome, флаги запуска. Настоящий Chrome здесь не запускается: запуск и печать подменены.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/brauzer.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { sozdatPechatnika, zapustitChrome, PechatZanyata } = require("./brauzer");

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

test("очередь: ждущий дольше срока ожидания получает PechatZanyata и уходит из очереди; идущая печать и порядок целы", async () => {
  const s = podmenaChrome();
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, maxZhdut: 1, srok: 5000, zhdatMs: 80 });
  const kak = (p) => p.then((pdf) => pdf.toString(), (e) => e);
  const idet = kak(pechatat("идёт"));
  while (s.zhdut.length === 0) await tik();
  const zhdun = kak(pechatat("ждёт"));
  const itog = await Promise.race([zhdun, spat(1500).then(() => "не отказал за 1,5 с")]);
  assert.ok(itog instanceof PechatZanyata, `ждущий дольше срока ожидания не получил PechatZanyata: ${itog}`);
  assert.equal(itog.code, "PECHAT_ZANYATA");
  // Из очереди убран: его место свободно (maxZhdut: 1), третий встаёт ждать, а не получает отказ
  const tretiy = kak(pechatat("третий"));
  await tik();
  s.zhdut.shift()(); // «идёт» допечатана — место переходит «третьему», а не ушедшему «ждёт»
  assert.equal(await idet, "идёт");
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  assert.equal(await tretiy, "третий");
  assert.deepEqual(s.poryadok, ["идёт", "третий"]);
  assert.equal(s.zapuskov, 2);
});

test("очередь: таймер ожидания не висит после выхода из очереди — ни когда место получено, ни когда срок вышел", async () => {
  const taymerov = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const do0 = taymerov();
  const s = podmenaChrome();
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, maxZhdut: 2, srok: 5000, zhdatMs: 20000 });
  const a = pechatat("a");
  while (s.zhdut.length === 0) await tik();
  const b = pechatat("b");
  await tik();
  assert.ok(taymerov() > do0, "ждущий в очереди без таймера ожидания");
  s.zhdut.shift()();
  await a;
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  await b;
  assert.equal(taymerov(), do0, "после выхода из очереди остался висеть таймер");

  const kratkiy = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, srok: 5000, zhdatMs: 30 });
  const c = kratkiy("c");
  while (s.zhdut.length === 0) await tik();
  await assert.rejects(kratkiy("d"), PechatZanyata);
  s.zhdut.shift()();
  await c;
  assert.equal(taymerov(), do0, "после отказа по сроку остался висеть таймер");
});

test("очередь: клиент ушёл, пока печать ждала места, — Chrome не запускают, место идёт следующему", async () => {
  const s = podmenaChrome();
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, maxZhdut: 5, srok: 5000 });
  const kak = (p) => p.then((pdf) => pdf.toString(), (e) => e);
  let ushel = false;
  const idet = kak(pechatat("идёт"));
  while (s.zhdut.length === 0) await tik();
  const ushedshiy = kak(pechatat("ушёл", { klientTut: () => !ushel }));
  const sleduyushchiy = kak(pechatat("следом", { klientTut: () => true }));
  await tik();
  ushel = true; // клиент «ушёл», пока обе ждут
  s.zhdut.shift()();
  assert.equal(await idet, "идёт");
  const otkaz = await ushedshiy;
  assert.equal(otkaz.code, "KLIENT_USHEL");
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  assert.equal(await sleduyushchiy, "следом");
  assert.deepEqual(s.poryadok, ["идёт", "следом"]);
  assert.equal(s.zapuskov, 2, "Chrome запускали для ушедшего клиента");
  assert.equal(s.zakryto, 2);
});

test("закрытие: Chrome не закрылся за срок или закрылся с ошибкой — процесс убивают SIGKILL; закрылся — не трогают", async (t) => {
  const pechatatBystro = async (browser, html) => Buffer.from(html);
  const sCrome = (close) => {
    const kill = t.mock.fn();
    return { kill, zapustit: async () => ({ close, process: () => ({ kill }) }) };
  };

  const zavis = sCrome(() => new Promise(() => {})); // close() не возвращается никогда
  const t0 = Date.now();
  const pechatat = sozdatPechatnika({ zapustit: zavis.zapustit, pechatat: pechatatBystro, srok: 5000, zakrytieMs: 40 });
  assert.equal((await pechatat("x")).toString(), "x");
  assert.deepEqual(zavis.kill.mock.calls.map((c) => c.arguments), [["SIGKILL"]]);
  assert.ok(Date.now() - t0 < 2000, "зависший Chrome держал печать слишком долго");

  const oshibka = sCrome(async () => { throw new Error("закрыть не вышло"); });
  await sozdatPechatnika({ zapustit: oshibka.zapustit, pechatat: pechatatBystro, srok: 5000, zakrytieMs: 40 })("y");
  assert.deepEqual(oshibka.kill.mock.calls.map((c) => c.arguments), [["SIGKILL"]]);

  const zdorovyy = sCrome(async () => {});
  await sozdatPechatnika({ zapustit: zdorovyy.zapustit, pechatat: pechatatBystro, srok: 5000, zakrytieMs: 40 })("z");
  assert.equal(zdorovyy.kill.mock.callCount(), 0);

  // Процесса у браузера уже нет (process() вернул null): закрытие не падает
  const bezProcessa = sozdatPechatnika({ zapustit: async () => ({ close: () => new Promise(() => {}), process: () => null }), pechatat: pechatatBystro, srok: 5000, zakrytieMs: 40 });
  assert.equal((await bezProcessa("w")).toString(), "w");
});

test("запуск Chrome: puppeteer не перехватывает SIGINT, SIGTERM, SIGHUP — ни на Linux, ни на Mac", async () => {
  const zapuski = [];
  const puppeteer = { defaultArgs: async ({ args }) => args, launch: async (opcii) => { zapuski.push(opcii); return { podmena: true }; } };
  const chromium = { args: ["--podmena"], executablePath: async () => "/tmp/chromium-podmena" };
  const zagruzit = async (imya) => ({ default: imya === "puppeteer-core" ? puppeteer : chromium });
  const bylo = process.env.CHROME_PATH;
  process.env.CHROME_PATH = process.execPath; // существующий файл: проверка «Chrome есть» проходит
  try {
    await zapustitChrome({ srok: 1234, zagruzit, platforma: "linux" });
    await zapustitChrome({ srok: 1234, zagruzit, platforma: "darwin" });
  } finally {
    if (bylo === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = bylo;
  }
  assert.equal(zapuski.length, 2);
  for (const opcii of zapuski) {
    assert.equal(opcii.handleSIGINT, false);
    assert.equal(opcii.handleSIGTERM, false);
    assert.equal(opcii.handleSIGHUP, false);
    assert.equal(opcii.timeout, 1234);
  }
  // Остальные параметры запуска прежние
  assert.equal(zapuski[0].executablePath, "/tmp/chromium-podmena");
  assert.equal(zapuski[0].headless, "shell");
  assert.deepEqual(zapuski[0].args, ["--podmena"]);
  assert.equal(zapuski[1].executablePath, process.execPath);
  assert.equal(zapuski[1].headless, true);
  assert.equal(zapuski[1].pipe, true);
});

test("очередь: pechatat в опциях печати — печатник страницы только для этой печати; очередь и Chrome общие, по умолчанию печатник прежний", async () => {
  const s = podmenaChrome();
  const strogiy = async (browser, html, opcii) => Buffer.from(`строгий:${html}:${opcii.timeout}`);
  const pechatat = sozdatPechatnika({ zapustit: s.zapustit, pechatat: s.pechatat, maxZhdut: 5, srok: 5000 });
  const kak = (p) => p.then((pdf) => pdf.toString(), (e) => e);

  const smeta = kak(pechatat("смета")); // печатник по умолчанию
  while (s.zhdut.length === 0) await tik();
  const dokument = kak(pechatat("документ", { pechatat: strogiy })); // свой печатник, но место одно на обоих
  await tik();
  await tik();
  assert.equal(s.aktivno, 1, "документ пошёл в печать, не дождавшись сметы");
  assert.equal(s.zapuskov, 1);
  s.zhdut.shift()();
  assert.equal(await smeta, "смета");
  assert.equal(await dokument, "строгий:документ:5000");
  assert.deepEqual(s.poryadok, ["смета"], "печатник по умолчанию позван и для документа со своим печатником");
  assert.equal(s.zapuskov, 2);
  assert.equal(s.zakryto, 2, "Chrome после печати документа не закрыт");
  assert.equal(s.maxAktivno, 1);

  // Следующая печать без pechatat — снова печатник по умолчанию
  const snova = kak(pechatat("снова смета"));
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  assert.equal(await snova, "снова смета");
  assert.deepEqual(s.poryadok, ["смета", "снова смета"]);

  // Печатник страницы падает — ошибка доходит, Chrome закрыт, место свободно
  const upal = await kak(pechatat("падает", { pechatat: async () => { throw new Error("страница упала"); } }));
  assert.match(upal.message, /страница упала/);
  assert.equal(s.zakryto, s.zapuskov, "Chrome после упавшей печати не закрыт");
  const potom = kak(pechatat("потом"));
  while (s.zhdut.length === 0) await tik();
  s.zhdut.shift()();
  assert.equal(await potom, "потом");
});

test("запуск Chrome: добавочные аргументы (argumenty) попадают в запуск — Linux: после аргументов пакета, Mac: в args; без них запуск прежний", async () => {
  const zapuski = [];
  const puppeteer = { defaultArgs: async ({ args }) => ["--default", ...args], launch: async (opcii) => { zapuski.push(opcii); return { podmena: true }; } };
  const chromium = { args: ["--podmena"], executablePath: async () => "/tmp/chromium-podmena" };
  const zagruzit = async (imya) => ({ default: imya === "puppeteer-core" ? puppeteer : chromium });
  const bylo = process.env.CHROME_PATH;
  process.env.CHROME_PATH = process.execPath;
  try {
    await zapustitChrome({ srok: 1, zagruzit, platforma: "linux", argumenty: ["--a=1", "--b=2"] });
    await zapustitChrome({ srok: 1, zagruzit, platforma: "darwin", argumenty: ["--a=1", "--b=2"] });
    await zapustitChrome({ srok: 1, zagruzit, platforma: "linux" });
    await zapustitChrome({ srok: 1, zagruzit, platforma: "darwin" });
  } finally {
    if (bylo === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = bylo;
  }
  assert.deepEqual(zapuski[0].args, ["--default", "--podmena", "--a=1", "--b=2"]);
  assert.deepEqual(zapuski[1].args, ["--a=1", "--b=2"]);
  assert.deepEqual(zapuski[2].args, ["--default", "--podmena"], "без argumenty запуск на Linux изменился");
  assert.deepEqual(zapuski[3].args, []);
  for (const opcii of zapuski) assert.equal(opcii.handleSIGTERM, false);
});

test("очередь: argumenty в опциях печати доходят до запуска Chrome только на эту печать", async () => {
  const zapuski = [];
  const pechatat = sozdatPechatnika({
    zapustit: async (o) => { zapuski.push(o.argumenty); return { close: async () => {}, process: () => null }; },
    pechatat: async () => Buffer.from("x"),
    srok: 5000,
  });
  await pechatat("a", { argumenty: ["--x"] });
  await pechatat("b");
  assert.deepEqual(zapuski, [["--x"], undefined]);
});
