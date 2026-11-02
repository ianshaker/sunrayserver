"use strict";

// Обработчик Mango (webhook.js, db.js) на подделках: ошибка сохранения итога → 503, сброс сессии звонка перед ответом 5xx,
// поздний повтор Appeared без Telegram. Клиент Supabase общий для webhook.js, db.js и crmLookup.js (lib/supabaseClient):
// подменяем его в кэше модулей до их загрузки, env и сети не нужно. Лог Mango выключаем: в консоли не должно быть телефонов.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test mango.calls.new/webhook.test.js

process.env.MANGO_DEBUG_LOG = "false";

const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { podmenaSupabase, shag, podmenaLog, peredacha, pamyatMangoEvents } = require("./podmenaSupabase");

// Что отвечает «база CRM» и что в неё писали; меняется тестами.
const baza = {};
function sbrositBazu() {
  Object.assign(baza, {
    oshibkaUpsert: null,
    oshibkaId: null,
    oshibkaVstavki: null,
    klientNaiden: false,
    nomer: "A-100",
    zapisi: [],
    vorota: null, // Promise: пока не выполнен, поиск клиента по телефону (appeals) не отвечает
    uVorot: 0, // сколько поисков встало на воротах
    vorotaVstavki: null, // Promise: пока не выполнен, вставка заявки (appeals.insert) не отвечает
    uVorotVstavki: 0, // сколько вставок встало на воротах
  });
}
sbrositBazu();

const TELEFON = "79990001122";
const SEKRET = "SEKRET-PROKSI-d41d8cd9";
const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const MINUT = 60 * 1000;

// «Ворота» поиска клиента и вставки заявки: так тест удерживает Appeared на поиске (или на вставке), пока приходит другое
// событие того же звонка.
function otvetCrm(z) {
  if (z.tablitsa === "appeals" && shag(z, "ilike") && baza.vorota) {
    baza.uVorot += 1;
    return baza.vorota.then(() => otvetBazy(z));
  }
  if (z.tablitsa === "appeals" && shag(z, "insert") && baza.vorotaVstavki) {
    baza.uVorotVstavki += 1;
    return baza.vorotaVstavki.then(() => otvetBazy(z));
  }
  return otvetBazy(z);
}

function otvetBazy(z) {
  const tablitsa = z.tablitsa;
  if (tablitsa === "mango_calls" && shag(z, "upsert")) {
    baza.zapisi.push(["mango_calls.upsert", shag(z, "upsert")[0][0].entry_id]);
    return { data: null, error: baza.oshibkaUpsert };
  }
  if (tablitsa === "ids" && shag(z, "update")) {
    baza.zapisi.push(["ids.update", shag(z, "update")[0]]);
    return { data: null, error: null };
  }
  if (tablitsa === "ids" && shag(z, "select")) {
    return baza.oshibkaId ? { data: null, error: baza.oshibkaId } : { data: [{ appeal_id: baza.nomer }], error: null };
  }
  if (tablitsa === "appeals" && shag(z, "insert")) {
    baza.zapisi.push(["appeals.insert", shag(z, "insert")[0][0]]);
    return { data: null, error: baza.oshibkaVstavki };
  }
  if (tablitsa === "appeals" && shag(z, "ilike") && baza.klientNaiden) {
    const { formatPhoneNumber } = require("./format");
    return { data: [{ appeal_number: "A-7", client_name: "Иван", phone: formatPhoneNumber(TELEFON), city: "", dialog: "" }], error: null };
  }
  return { data: [], error: null };
}

const klientPath = require.resolve("../lib/supabaseClient");
require.cache[klientPath] = {
  id: klientPath,
  filename: klientPath,
  loaded: true,
  exports: { supabase: podmenaSupabase(otvetCrm), supabaseAnon: {}, logSupabaseBoot() {} },
};

const { handleMangoWebhook } = require("./webhook");
const { activeCalls, callMessages, entryCallMeta, zavershennyeZvonki, otlozhennyeSessii } = require("./state");
const { CallCard } = require("./callCard");
const { renderCallCard } = require("./renderCallCard");
const { TELEGRAM_CHAT_ID } = require("./constants");
const { registerMarshrutyProksi } = require("./marshrutyProksi");
const { sozdatZamok } = require("./zamokProksi");

// Telegram: любой вызов бота записывается (карточка = sendMessage / editMessageText).
const vyzovyBota = [];
const bot = new Proxy(
  {},
  {
    get: (_, imya) => async () => {
      vyzovyBota.push(String(imya));
      return { message_id: 111 };
    },
  },
);

function sbrositSostoyanie() {
  sbrositBazu();
  vyzovyBota.length = 0;
  for (const kluch of Object.keys(callMessages)) delete callMessages[kluch];
  for (const kluch of Object.keys(activeCalls)) delete activeCalls[kluch];
  for (const kluch of Object.keys(entryCallMeta)) delete entryCallMeta[kluch];
  zavershennyeZvonki.clear();
  otlozhennyeSessii.clear();
}

// Тихая консоль на время теста: обработчик пишет номера телефонов в console.log.
function tishina(t) {
  t.mock.method(console, "log", () => {});
}

function podgotovit(t) {
  sbrositSostoyanie();
  tishina(t);
  t.after(sbrositSostoyanie);
}

const NOMER_V_KARTOCHKE = "8(999)000-11-22";
const APPEARED = {
  entry_id: "E-2",
  call_id: "C-2",
  call_state: "Appeared",
  location: "abonent",
  timestamp: 1760700000,
  from: { number: TELEFON },
  to: { number: "101", line_number: "74950000000" },
};
const ITOG_VKHODYASHCHIY = {
  entry_id: "E-1",
  call_id: "C-1",
  call_direction: 1,
  from: { number: TELEFON },
  to: { number: "101", line_number: "74950000000" },
  create_time: 1760700000,
  forward_time: 1760700005,
  talk_time: 1760700010,
  end_time: 1760700100,
  disconnect_reason: 1000,
  line_number: "74950000000",
};

// Прямой вызов обработчика: поддельные запрос и ответ.
async function vyzvat(obj, { bezTelegram, botDlyaKarto4ki = bot } = {}) {
  const otvet = {
    kod: 200,
    telo: null,
    code(kod) {
      this.kod = kod;
      return this;
    },
    send(telo) {
      this.telo = telo;
      return this;
    },
  };
  const zapros = { body: { json: JSON.stringify(obj) }, url: "/events/call", mangoBezTelegram: bezTelegram };
  await handleMangoWebhook(zapros, otvet, botDlyaKarto4ki);
  return otvet;
}

// Бот, который запоминает тексты карточек (sendMessage и editMessageText), чтобы читать, что увидит менеджер.
function botSTekstom() {
  const teksty = [];
  const vyzovy = [];
  const bot = new Proxy(
    {},
    {
      get: (_, imya) => async (...args) => {
        vyzovy.push(String(imya));
        if (imya === "sendMessage") teksty.push(String(args[1]));
        if (imya === "editMessageText") teksty.push(String(args[0]));
        return { message_id: 222 };
      },
    },
  );
  return { bot, poslednyaya: () => teksty[teksty.length - 1] || "", vse: () => teksty.slice(), vyzovy };
}

const zapisiBazy = (imya) => baza.zapisi.filter(([nazvanie]) => nazvanie === imya);

// ---------------------------------------------------------------------------------------------
// П2: итог звонка не сохранился → 503 (прокси дошлёт; upsert по entry_id повторяется без вреда)
// ---------------------------------------------------------------------------------------------

test("а) входящий итог: ошибка upsert → 503 до карточки Telegram, метаданные IVR на месте; успех → summary_sent, карточка, метаданные убраны", async (t) => {
  podgotovit(t);
  entryCallMeta["E-1"] = { lineNumber: "74950000000", lineName: "Линия", formattedFromNumber: NOMER_V_KARTOCHKE, ivrAppearedAt: 1 };

  baza.oshibkaUpsert = { message: "upstream down", code: "PGRST000" };
  const sboy = await vyzvat(ITOG_VKHODYASHCHIY);
  assert.deepEqual([sboy.kod, sboy.telo], [503, { error: "summary_save_failed" }]);
  assert.deepEqual(vyzovyBota, [], "Telegram не тронут: повтор отработает целиком, карточка не задвоится");
  assert.ok(entryCallMeta["E-1"], "метаданные IVR нужны повтору (линия)");
  assert.equal(zapisiBazy("mango_calls.upsert").length, 1);

  baza.oshibkaUpsert = null;
  const uspeh = await vyzvat(ITOG_VKHODYASHCHIY);
  assert.deepEqual([uspeh.kod, uspeh.telo], [200, { status: "summary_sent" }]);
  assert.ok(vyzovyBota.length > 0, "карточка отправлена");
  assert.equal(entryCallMeta["E-1"], undefined, "после успешного сохранения метаданные убраны");
  assert.equal(zapisiBazy("mango_calls.upsert").length, 2, "тот же upsert по entry_id");
});

test("б) исходящий итог: ошибка upsert → 503; успех → outgoing_saved, Telegram не нужен", async (t) => {
  podgotovit(t);
  const ishodyashchiy = { ...ITOG_VKHODYASHCHIY, entry_id: "E-3", call_id: "C-3", call_direction: 2, from: { number: "101" }, to: { number: TELEFON } };

  baza.oshibkaUpsert = { message: "denied", code: "42501" };
  const sboy = await vyzvat(ishodyashchiy);
  assert.deepEqual([sboy.kod, sboy.telo], [503, { error: "summary_save_failed" }]);

  baza.oshibkaUpsert = null;
  const uspeh = await vyzvat(ishodyashchiy);
  assert.deepEqual([uspeh.kod, uspeh.telo], [200, { status: "outgoing_saved" }]);
  assert.deepEqual(vyzovyBota, []);
});

// ---------------------------------------------------------------------------------------------
// П2/П6/П10: ответ 5xx на Appeared — сессия звонка сбрасывается, повтор обрабатывается как новый звонок
// ---------------------------------------------------------------------------------------------

test("в) Appeared нового клиента: заявка не создалась (ошибка вставки) → 503, сессия и метка звонка сброшены; повтор создаёт заявку", async (t) => {
  podgotovit(t);
  baza.oshibkaVstavki = { message: "insert failed", code: "XX000" };
  const sboy = await vyzvat(APPEARED);
  assert.deepEqual([sboy.kod, sboy.telo], [503, { error: "insert_error" }]);
  assert.equal(callMessages[NOMER_V_KARTOCHKE], undefined, "сессия номера сброшена");
  assert.equal(activeCalls["C-2"], undefined, "метка звонка сброшена");
  assert.ok(vyzovyBota.length > 0, "на карточке остаётся запись об ошибке");
  assert.equal(zapisiBazy("appeals.insert").length, 1);

  baza.oshibkaVstavki = null;
  const povtor = await vyzvat(APPEARED);
  assert.deepEqual([povtor.kod, povtor.telo], [200, { status: "appeared_processed" }], "повтор принят как новый звонок, а не как дозвон");
  assert.equal(zapisiBazy("appeals.insert").length, 2);
  assert.ok(callMessages[NOMER_V_KARTOCHKE], "теперь живая сессия есть");
});

test("г) Appeared: нет свободного номера заявки → 500, сессия и метка звонка сброшены (activeCalls тоже); повтор проходит как новый", async (t) => {
  podgotovit(t);
  baza.oshibkaId = { message: "ids down", code: "XX000" };
  const sboy = await vyzvat(APPEARED);
  assert.deepEqual([sboy.kod, sboy.telo], [500, { error: "id_error" }]);
  assert.equal(callMessages[NOMER_V_KARTOCHKE], undefined);
  assert.equal(activeCalls["C-2"], undefined);

  baza.oshibkaId = null;
  const povtor = await vyzvat(APPEARED);
  assert.deepEqual([povtor.kod, povtor.telo], [200, { status: "appeared_processed" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 1);
});

test("д) сброс при 5xx не трогает чужую сессию того же номера: итог звонка уже забрал сессию, а новый звонок создал свою", async (t) => {
  podgotovit(t);
  baza.oshibkaVstavki = { message: "insert failed", code: "XX000" };
  // пока идёт вставка, «чужая» сессия занимает место: подменяем её в момент вставки
  const chuzhaya = { callData: { managers: [] }, foundInfoList: [], finished: false };
  const iskhodnyy = baza.zapisi.push.bind(baza.zapisi);
  baza.zapisi.push = (zapis) => {
    if (zapis[0] === "appeals.insert") callMessages[NOMER_V_KARTOCHKE] = chuzhaya;
    return iskhodnyy(zapis);
  };
  const otvet = await vyzvat(APPEARED);
  assert.equal(otvet.kod, 503);
  assert.equal(callMessages[NOMER_V_KARTOCHKE], chuzhaya, "чужую сессию не удаляем");
  assert.equal(activeCalls["C-2"], undefined);
});

test("е) живой Appeared нового клиента как раньше: карточка, заявка с теми же полями, сессия в памяти", async (t) => {
  podgotovit(t);
  const otvet = await vyzvat(APPEARED);
  assert.deepEqual([otvet.kod, otvet.telo], [200, { status: "appeared_processed" }]);
  assert.ok(vyzovyBota.length > 0);
  assert.ok(callMessages[NOMER_V_KARTOCHKE]);
  assert.equal(activeCalls["C-2"], true);

  const [[, zayavka]] = zapisiBazy("appeals.insert");
  assert.deepEqual(Object.keys(zayavka).sort(), [
    "address", "appeal_number", "city", "client_name", "created_at", "detailed_address", "dialog", "manager", "phone",
    "product_type", "reminder_date", "reminder_time", "source", "status", "task_description", "updated_at",
  ]);
  assert.equal(zayavka.appeal_number, "A-100");
  assert.equal(zayavka.phone, NOMER_V_KARTOCHKE);
  assert.equal(zayavka.status, "Активно");
  assert.equal(zayavka.product_type, "Продукт не указан");
  assert.equal(zayavka.reminder_time, null);
  assert.deepEqual(zapisiBazy("ids.update").map(([, polya]) => polya.is_used), [true], "номер помечен занятым");
});

// ---------------------------------------------------------------------------------------------
// П9: поздний повтор Appeared — заявка новому клиенту создаётся, Telegram и сессии не трогаем
// ---------------------------------------------------------------------------------------------

test("ж) обработчик с флагом mangoBezTelegram: новый клиент → заявка есть, Telegram не звался, callMessages и activeCalls пусты", async (t) => {
  podgotovit(t);
  const otvet = await vyzvat(APPEARED, { bezTelegram: true });
  assert.deepEqual([otvet.kod, otvet.telo.status], [200, "appeared_late_appeal_created"]);
  assert.deepEqual(vyzovyBota, [], "Telegram не звался");
  assert.deepEqual(Object.keys(callMessages), []);
  assert.deepEqual(Object.keys(activeCalls), []);
  const [[, zayavka]] = zapisiBazy("appeals.insert");
  assert.equal(zayavka.phone, NOMER_V_KARTOCHKE);
  assert.equal(zayavka.appeal_number, "A-100");
  assert.equal(zapisiBazy("ids.update").length, 1);

  // клиент уже есть в CRM: заявку не заводим
  sbrositSostoyanie();
  baza.klientNaiden = true;
  const naiden = await vyzvat(APPEARED, { bezTelegram: true });
  assert.deepEqual([naiden.kod, naiden.telo.status], [200, "appeared_late_client_found"]);
  assert.deepEqual(zapisiBazy("appeals.insert"), []);
  assert.deepEqual(vyzovyBota, []);

  // сбой базы — 503, чтобы прокси дослал
  sbrositSostoyanie();
  baza.oshibkaVstavki = { message: "insert failed", code: "XX000" };
  const sboy = await vyzvat(APPEARED, { bezTelegram: true });
  assert.deepEqual([sboy.kod, sboy.telo], [503, { error: "late_appeal_failed" }]);
  baza.oshibkaVstavki = null;
  baza.oshibkaId = { message: "ids down", code: "XX000" };
  assert.equal((await vyzvat(APPEARED, { bezTelegram: true })).kod, 503);
  assert.deepEqual(vyzovyBota, []);
  assert.deepEqual(Object.keys(callMessages), []);
});

// Приложение целиком: замок на onRequest, журнал в памяти, настоящий обработчик; маршруты /events/call и /events/summary
// как в server.js. botDlyaKarto4ki — бот, в который уходят карточки (по умолчанию общий bot).
async function prilozhenie(t, { botDlyaKarto4ki = bot } = {}) {
  const app = Fastify();
  app.register(require("@fastify/formbody"));
  const pamyat = pamyatMangoEvents();
  const chasy = { teper: NOW };
  const zhurnalLog = podmenaLog();
  const env = { MANGO_PROXY_SECRET: SEKRET, MANGO_PROXY_SECRET_REQUIRED: "1" };
  const zamok = sozdatZamok({ env, log: podmenaLog().log });
  const zhurnal = registerMarshrutyProksi(app, sozdatZamok({ env, log: podmenaLog().log, tolkoSekret: true }), {
    supabase: podmenaSupabase(pamyat.otvet),
    log: zhurnalLog.log,
    now: () => chasy.teper,
    chistka: false,
  });
  for (const put of ["/events/call", "/events/summary"]) {
    app.post(
      put,
      { bodyLimit: 1024 * 1024, onRequest: zamok, preHandler: zhurnal.preHandler, onSend: zhurnal.onSend },
      (req, res) => handleMangoWebhook(req, res, botDlyaKarto4ki),
    );
  }
  await app.ready();
  t.after(() => app.close());
  const otpravitPo = (put) => (obj, zagolovki = {}) =>
    app.inject({
      method: "POST",
      url: put,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-proxy-secret": SEKRET, ...zagolovki },
      payload: new URLSearchParams({ vpbx_api_key: "KLYUCH", sign: "PODPIS", json: JSON.stringify(obj) }).toString(),
    });
  return { app, pamyat, chasy, zhurnalLog, otpravit: otpravitPo("/events/call"), otpravitItog: otpravitPo("/events/summary") };
}

test("з) через журнал: поздний Appeared (x-mango-povtor: 1, старше 10 мин) нового клиента → заявка создана, Telegram не звался; строка журнала true/200", async (t) => {
  podgotovit(t);
  const { pamyat, otpravit } = await prilozhenie(t);
  const pozdno = { "x-mango-povtor": "1", "x-mango-prinyato": new Date(NOW - 11 * MINUT).toISOString() };

  const otvet = await otpravit(APPEARED, pozdno);
  await peredacha();
  assert.equal(otvet.statusCode, 200);
  assert.equal(otvet.json().status, "appeared_late_appeal_created");
  assert.equal(zapisiBazy("appeals.insert").length, 1, "заявка создана");
  assert.deepEqual(vyzovyBota, [], "Telegram не звался");
  assert.deepEqual(Object.keys(callMessages), []);
  assert.deepEqual(Object.keys(activeCalls), []);
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod, pamyat.stroki[0].povtor], [true, 200, true]);

  // тот же повтор ещё раз — дубль, заявка второй раз не заводится
  const dubl = await otpravit(APPEARED, pozdno);
  assert.deepEqual(dubl.json(), { ok: true, duplicate: true });
  assert.equal(zapisiBazy("appeals.insert").length, 1);

  // другие поздние call-события (не Appeared@abonent) остаются «только запись»
  const connected = await otpravit({ ...APPEARED, call_state: "Connected", seq: 5 }, pozdno);
  assert.deepEqual(connected.json(), { ok: true, stale: true });
  assert.deepEqual(vyzovyBota, []);
});

test("и) через журнал: поздний Appeared, а заявку не создали (сбой базы) → 503, строка не обработана; повтор после аренды доводит дело; Appeared по звонку с итогом в журнале — тоже без Telegram", async (t) => {
  podgotovit(t);
  const { pamyat, chasy, zhurnalLog, otpravit, otpravitItog } = await prilozhenie(t);
  const pozdno = () => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - 11 * MINUT).toISOString() });

  baza.oshibkaVstavki = { message: "insert failed", code: "XX000" };
  const sboy = await otpravit(APPEARED, pozdno());
  await peredacha();
  assert.deepEqual([sboy.statusCode, sboy.json()], [503, { error: "late_appeal_failed" }]);
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [false, 503]);

  baza.oshibkaVstavki = null;
  chasy.teper += 61 * 1000;
  const povtor = await otpravit(APPEARED, pozdno());
  await peredacha();
  assert.equal(povtor.json().status, "appeared_late_appeal_created");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);
  assert.deepEqual(vyzovyBota, []);

  // П6: свежий (не поздний) повтор Appeared другого звонка, по которому итог уже в журнале, — тот же путь без Telegram.
  // Disconnected звонок не заканчивает (его приводит и перевод с робота, и конец одного плеча дозвона): только итог.
  sbrositBazu();
  const drugoy = { ...APPEARED, entry_id: "E-9", call_id: "C-9", from: { number: "79990003344" } };
  const itogDrugogo = { ...ITOG_VKHODYASHCHIY, entry_id: "E-9", call_id: "C-9", from: { number: "79990003344" } };
  assert.equal((await otpravitItog(itogDrugogo)).statusCode, 200);
  assert.equal(pamyat.stroki.at(-1).vid, "summary", "итог лёг в журнал как summary");
  const botDoPovtora = vyzovyBota.length; // карточка самого итога (сессии не было) ушла сама по себе
  const svezhiy = { "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() };
  const posleItoga = await otpravit(drugoy, svezhiy);
  assert.equal(posleItoga.json().status, "appeared_late_appeal_created");
  assert.equal(zapisiBazy("appeals.insert").length, 1);
  assert.equal(vyzovyBota.length, botDoPovtora, "Telegram по опоздавшему Appeared не звался");
  assert.deepEqual(Object.keys(callMessages), [], "сессия живого звонка по законченному не заводится");

  // в лог — одна строка на каждое решение «повтор опоздал» с причиной, без телефона
  const opozdal = zhurnalLog.zapisi.filter((z) => z.uroven === "warn").map((z) => z.tekst);
  assert.equal(opozdal.length, 3);
  assert.match(opozdal[0], /^\[mango_events\] \/events\/call entry=E-2: повтор опоздал \(старше 10 минут\) — без карточки Telegram$/);
  assert.match(opozdal[1], /entry=E-2: повтор опоздал \(старше 10 минут\)/);
  assert.match(opozdal[2], /^\[mango_events\] \/events\/call entry=E-9: повтор опоздал \(итог звонка уже пришёл\) — без карточки Telegram$/);
  assert.ok(!JSON.stringify(zhurnalLog.zapisi).includes("7999000"), "телефонов в логе нет");
});

// ---------------------------------------------------------------------------------------------
// Итог звонка без живой сессии (Появился опоздал и пришёл после конца звонка): карточка сама ищет клиента.
// Раньше такая карточка собиралась без поиска и писала «Клиент не найден в базе», хотя клиент был.
// ---------------------------------------------------------------------------------------------

test("к) итог звонка без сессии: клиент в базе → в карточке история клиента, а не «не найден»; клиента нет → «не найден» остаётся", async (t) => {
  podgotovit(t);
  const ITOG_PROPUSHCHEN = ITOG_VKHODYASHCHIY;
  const ITOG_PRINYAT = { ...ITOG_VKHODYASHCHIY, entry_result: 1 };

  // клиент есть в CRM, сессии нет: пропущенный звонок
  baza.klientNaiden = true;
  const kartochka = botSTekstom();
  const propushchen = await vyzvat(ITOG_PROPUSHCHEN, { botDlyaKarto4ki: kartochka.bot });
  assert.deepEqual([propushchen.kod, propushchen.telo], [200, { status: "summary_sent" }]);
  assert.match(kartochka.poslednyaya(), /История клиента \(1 запись\)/);
  assert.match(kartochka.poslednyaya(), /A-7/);
  assert.doesNotMatch(kartochka.poslednyaya(), /Клиент не найден/);

  // то же для принятого звонка: раздел истории есть
  sbrositSostoyanie();
  baza.klientNaiden = true;
  const kartochka2 = botSTekstom();
  await vyzvat({ ...ITOG_PRINYAT, entry_id: "E-5", call_id: "C-5" }, { botDlyaKarto4ki: kartochka2.bot });
  assert.match(kartochka2.poslednyaya(), /История клиента/);

  // клиента правда нет: честное «не найден», заявка при итоге не заводится
  sbrositSostoyanie();
  const kartochka3 = botSTekstom();
  await vyzvat({ ...ITOG_PROPUSHCHEN, entry_id: "E-6", call_id: "C-6" }, { botDlyaKarto4ki: kartochka3.bot });
  assert.match(kartochka3.poslednyaya(), /Клиент не найден в базе, заявка не создавалась/);
  assert.deepEqual(zapisiBazy("appeals.insert"), []);

  // сбой базы при поиске не роняет итог: карточка уходит, ответ 200
  sbrositSostoyanie();
  baza.klientNaiden = true;
  const kartochka4 = botSTekstom();
  const supabasePath = require.resolve("../lib/supabaseClient");
  const iskhodnyy = require.cache[supabasePath].exports.supabase.from;
  require.cache[supabasePath].exports.supabase.from = (tablitsa) => {
    if (tablitsa === "dogovorfinished") throw new Error("search down");
    return iskhodnyy.call(require.cache[supabasePath].exports.supabase, tablitsa);
  };
  t.after(() => {
    require.cache[supabasePath].exports.supabase.from = iskhodnyy;
  });
  const sboy = await vyzvat({ ...ITOG_PROPUSHCHEN, entry_id: "E-7", call_id: "C-7" }, { botDlyaKarto4ki: kartochka4.bot });
  assert.deepEqual([sboy.kod, sboy.telo], [200, { status: "summary_sent" }]);
  assert.ok(kartochka4.poslednyaya().length > 0, "карточка ушла несмотря на сбой поиска");
});

// ---------------------------------------------------------------------------------------------
// Настоящий звонок 02.11.2026: Mango → прокси → Render. Часть первых отправок теряется по дороге, прокси досылает их
// через ~40 с (x-mango-povtor: 1). Disconnected@ivr приходит в ту же секунду, когда звонок переведён с робота на
// менеджера, Disconnected@abonent — конец одного плеча дозвона; концом звонка считается только итог (summary).
// ---------------------------------------------------------------------------------------------

const LINIYA = "79585382001";
const NOMER_ZVONKA = { entry_id: "E-1102", call_id: "C-1102" };
// Событие звонка 02.11: ivr — звонок поступил на линию, abonent — дозвон менеджеру (по умолчанию Гена).
function sobytieZvonka(sostoyanie, mesto, polya = {}) {
  return {
    ...NOMER_ZVONKA,
    call_state: sostoyanie,
    location: mesto,
    timestamp: 1760700000,
    from: { number: TELEFON },
    to: { number: mesto === "ivr" ? LINIYA : "gennady", line_number: LINIYA },
    ...polya,
  };
}
const ITOG_ZVONKA = {
  ...ITOG_VKHODYASHCHIY,
  ...NOMER_ZVONKA,
  to: { number: "gennady", line_number: LINIYA },
  line_number: LINIYA,
  entry_result: 1,
};
// Досылка прокси: событие принято 40 секунд назад (меньше 10 минут — не «поздний» по возрасту).
const opozdavshee = (chasy) => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - 40 * 1000).toISOString() });
const chislo = (kartochka, imya) => kartochka.vyzovy.filter((v) => v === imya).length;

test("л) звонок 02.11: Disconnected@ivr при переводе на менеджера звонок не заканчивает — опоздавшие Appeared@abonent и Connected@abonent идут живой веткой, итог правит ту же карточку", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { pamyat, chasy, zhurnalLog, otpravit, otpravitItog } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });

  // робот: Appeared@ivr и в ту же секунду Disconnected@ivr (звонок ушёл менеджеру) — оба дошли вовремя
  const ivr = await otpravit(sobytieZvonka("Appeared", "ivr"));
  assert.deepEqual([ivr.statusCode, ivr.json()], [200, { status: "ivr_registered" }]);
  assert.equal((await otpravit(sobytieZvonka("Disconnected", "ivr"))).statusCode, 200);

  // первая отправка Appeared@abonent потерялась, прокси досылает её через 40 с
  const appeared = await otpravit(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }), opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([appeared.statusCode, appeared.json()], [200, { status: "appeared_processed" }], "живая ветка, а не stale");
  assert.equal(chislo(kartochka, "sendMessage"), 1, "карточка отправлена");
  assert.match(kartochka.poslednyaya(), /ВХОДЯЩИЙ ЗВОНОК/);
  assert.equal(zapisiBazy("appeals.insert").length, 1, "заявка новому клиенту заведена");
  assert.ok(callMessages[NOMER_V_KARTOCHKE], "сессия звонка в памяти");

  // Connected@abonent тоже досылается
  const connected = await otpravit(sobytieZvonka("Connected", "abonent", { timestamp: 1760700010, seq: 5 }), opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([connected.statusCode, connected.json()], [200, { status: "connected" }]);
  assert.match(kartochka.poslednyaya(), /Принят/, "карточка отредактирована: звонок принят");
  assert.ok(chislo(kartochka, "editMessageText") >= 1);
  assert.equal(chislo(kartochka, "sendMessage"), 1);

  // конец разговора и итог — вовремя; итоговая карточка редактирует то же сообщение
  assert.equal((await otpravit(sobytieZvonka("Disconnected", "abonent", { timestamp: 1760700100 }))).json().status, "disconnected");
  const itog = await otpravitItog(ITOG_ZVONKA);
  await peredacha();
  assert.deepEqual([itog.statusCode, itog.json()], [200, { status: "summary_sent" }]);
  assert.match(kartochka.poslednyaya(), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(chislo(kartochka, "sendMessage"), 1, "второго сообщения нет: итог правит ту же карточку");
  assert.deepEqual(Object.keys(callMessages), [], "сессия закрыта итогом");

  assert.deepEqual(
    pamyat.stroki.map((s) => [s.vid, s.sobytie, s.obrabotano]),
    [
      ["call", "Appeared@ivr", true],
      ["call", "Disconnected@ivr", true],
      ["call", "Appeared@abonent", true],
      ["call", "Connected@abonent", true],
      ["call", "Disconnected@abonent", true],
      ["summary", null, true],
    ],
  );
  assert.deepEqual(zhurnalLog.zapisi.filter((z) => z.uroven === "warn"), [], "ни один повтор не признан опоздавшим");
});

test("м) дозвон на двух менеджеров: Disconnected@abonent первого плеча — не конец звонка, опоздавший Appeared@abonent второго плеча идёт живой веткой и дописывает маршрут в ту же карточку", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { pamyat, chasy, otpravit } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });

  await otpravit(sobytieZvonka("Appeared", "ivr"));
  await otpravit(sobytieZvonka("Disconnected", "ivr"));
  assert.equal((await otpravit(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }))).json().status, "appeared_processed");
  // первый менеджер не ответил: конец его плеча
  assert.equal((await otpravit(sobytieZvonka("Disconnected", "abonent", { timestamp: 1760700020 }))).json().status, "disconnected");
  assert.ok(pamyat.stroki.some((s) => s.sobytie === "Disconnected@abonent"), "в журнале конец первого плеча");
  assert.ok(!pamyat.stroki.some((s) => s.vid === "summary"), "итога нет");

  // Appeared@abonent второго плеча дошёл с опозданием
  const vtoroy = sobytieZvonka("Appeared", "abonent", { timestamp: 1760700021, to: { number: "gleb", line_number: LINIYA } });
  const otvet = await otpravit(vtoroy, opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { status: "dialout_processed" }], "живая ветка: дозвон второму менеджеру");
  assert.match(kartochka.poslednyaya(), /Гена → Мякинина/, "маршрут в карточке дополнен вторым менеджером");
  assert.equal(chislo(kartochka, "sendMessage"), 1, "одна карточка на звонок");
  assert.equal(zapisiBazy("appeals.insert").length, 1, "заявка заведена один раз, на первом плече");
  assert.ok(callMessages[NOMER_V_KARTOCHKE], "сессия звонка жива");
});

test("н) опоздавшее Connected@abonent: итога в журнале нет — обрабатывается, карточка «Принят»; итог уже есть — 200 stale, карточка не меняется", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { chasy, zhurnalLog, otpravit, otpravitItog } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });

  await otpravit(sobytieZvonka("Appeared", "ivr"));
  await otpravit(sobytieZvonka("Disconnected", "ivr"));
  await otpravit(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }));
  assert.doesNotMatch(kartochka.poslednyaya(), /Принят/);

  // итога нет: Connected@abonent, дошедший с опозданием, обрабатывается
  const bezItoga = await otpravit(sobytieZvonka("Connected", "abonent", { timestamp: 1760700010, seq: 5 }), opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([bezItoga.statusCode, bezItoga.json()], [200, { status: "connected" }]);
  assert.match(kartochka.poslednyaya(), /Принят/);

  // звонок закончился: итог в журнале
  await otpravit(sobytieZvonka("Disconnected", "abonent", { timestamp: 1760700100 }));
  assert.equal((await otpravitItog(ITOG_ZVONKA)).json().status, "summary_sent");
  await peredacha();
  const vyzovovDoPovtora = kartochka.vyzovy.length;
  const tekstDoPovtora = kartochka.poslednyaya();
  assert.match(tekstDoPovtora, /ЗАВЕРШЁННЫЙ ЗВОНОК/);

  // ещё одна досылка Connected@abonent уже после итога: только запись
  const posleItoga = await otpravit(sobytieZvonka("Connected", "abonent", { timestamp: 1760700011, seq: 6 }), opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([posleItoga.statusCode, posleItoga.json()], [200, { ok: true, stale: true }]);
  assert.equal(kartochka.vyzovy.length, vyzovovDoPovtora, "бот не звался");
  assert.equal(kartochka.poslednyaya(), tekstDoPovtora, "карточка не изменилась");
  assert.deepEqual(Object.keys(callMessages), []);
  const opozdal = zhurnalLog.zapisi.filter((z) => z.uroven === "warn").map((z) => z.tekst);
  assert.deepEqual(opozdal, ["[mango_events] /events/call entry=E-1102: повтор опоздал (итог звонка уже пришёл) — без карточки Telegram"]);
});

// ---------------------------------------------------------------------------------------------
// Две дыры живой ветки опоздавших Appeared@abonent. entry_id — устойчивый идентификатор звонка целиком (два плеча дозвона
// делят его, call_id у плеч разные); сессия карточки лежит по телефону клиента, поэтому на номере может висеть чужая.
// ---------------------------------------------------------------------------------------------

// Ждём, пока условие станет истинным (события приложения идут через несколько тиков).
async function dozhdatsya(uslovie) {
  for (let i = 0; i < 500 && !uslovie(); i += 1) await peredacha();
  assert.ok(uslovie(), "не дождались условия");
}
const itogZvonka = (polya) => ({ ...ITOG_ZVONKA, ...polya });
const chislaTekstov = (kartochka, obrazec) => kartochka.vse().filter((tekst) => tekst.includes(obrazec)).length;

test("о) гонка итога и опоздавшего Appeared: Appeared нового клиента держится на поиске, пока приходит итог того же звонка → ответ 200, заявка одна, карточка итога одна (с номером заявки), сессий нет", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { pamyat, chasy, otpravit, otpravitItog } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });

  // Appeared@abonent досылается прокси; журнал итога не видит, пускает живой веткой; поиск клиента стоит на воротах
  let otkrytVorota;
  baza.vorota = new Promise((resolve) => {
    otkrytVorota = resolve;
  });
  const appearedZhdet = otpravit(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }), opozdavshee(chasy));
  await dozhdatsya(() => baza.uVorot > 0);
  assert.equal(chislo(kartochka, "sendMessage"), 1, "карточка уже отправлена, поиск клиента ещё идёт");
  assert.equal(zapisiBazy("appeals.insert").length, 0, "заявки пока нет");

  // пока Appeared ждёт, приходит итог того же звонка и забирает сессию
  const itog = await otpravitItog(ITOG_ZVONKA);
  assert.deepEqual([itog.statusCode, itog.json()], [200, { status: "summary_sent" }]);
  assert.deepEqual(Object.keys(callMessages), [], "итог забрал сессию");

  otkrytVorota();
  const appeared = await appearedZhdet;
  await peredacha();
  assert.deepEqual([appeared.statusCode, appeared.json()], [200, { status: "appeared_late_appeal_created" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 1, "заявка новому клиенту заведена ровно одна");
  assert.equal(chislo(kartochka, "sendMessage"), 1, "дублей сообщений нет");
  assert.equal(chislaTekstov(kartochka, "ВХОДЯЩИЙ ЗВОНОК"), 1, "живая карточка рисовалась один раз, до итога");
  assert.match(kartochka.poslednyaya(), /ЗАВЕРШЁННЫЙ ЗВОНОК/, "карточку не затёрли обратно в «входящий звонок»");
  assert.match(kartochka.poslednyaya(), /Создана новая заявка[\s\S]*A-100/, "номер поздней заявки дописан на карточку итога");
  assert.deepEqual(Object.keys(callMessages), [], "сессий не осталось");
  const stroka = pamyat.stroki.find((s) => s.sobytie === "Appeared@abonent");
  assert.deepEqual([stroka.obrabotano, stroka.kod], [true, 200], "журнал: Appeared обработан, прокси не досылает");
});

test("п) память завершения: итог звонка E-A обработан, потом опоздавший живой Appeared@abonent того же звонка идёт путём «без Telegram»; новый звонок с того же номера — отдельная карточка, а не дозвон", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { chasy, otpravit } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });
  const zvonokA = { entry_id: "E-A", call_id: "C-A" };

  // итог E-A идёт прямо в обработчик, мимо журнала приложения: журнал его не видит и сочтёт Appeared живым
  const itog = await vyzvat(itogZvonka(zvonokA), { botDlyaKarto4ki: kartochka.bot });
  assert.deepEqual([itog.kod, itog.telo], [200, { status: "summary_sent" }]);
  assert.equal(chislo(kartochka, "sendMessage"), 1, "карточка итога (сессии не было)");
  const vyzovovDoPovtora = kartochka.vyzovy.length;

  const pozdniy = await otpravit(sobytieZvonka("Appeared", "abonent", { ...zvonokA, timestamp: 1760700005 }), opozdavshee(chasy));
  await peredacha();
  assert.deepEqual([pozdniy.statusCode, pozdniy.json()], [200, { status: "appeared_late_appeal_created" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 1, "заявка новому клиенту есть");
  assert.equal(kartochka.vyzovy.length, vyzovovDoPovtora, "Telegram по законченному звонку не звался");
  assert.deepEqual(Object.keys(callMessages), [], "живая сессия не заведена");
  assert.deepEqual(Object.keys(activeCalls), []);

  // новый звонок с того же номера (другой entry_id): своя карточка, не дозвон к чужой. К этому времени на номере висит
  // живая сессия ещё одного звонка (E-Z): будь «дозвон» решён по телефону, E-B дописал бы маршрут в её карточку
  const zhivaya = {
    entryId: "E-Z",
    crmPhase: null,
    foundInfoList: [],
    createdAppealId: null,
    errorNote: null,
    finished: false,
    callData: { formattedFromNumber: NOMER_V_KARTOCHKE, lineName: "Линия", managers: ["Мякинина"], acceptedManager: null, managerLegs: [], currentLegIndex: -1 },
  };
  callMessages[NOMER_V_KARTOCHKE] = zhivaya;
  const novyy = await otpravit(sobytieZvonka("Appeared", "abonent", { entry_id: "E-B", call_id: "C-B", timestamp: 1760700500 }));
  await peredacha();
  assert.deepEqual([novyy.statusCode, novyy.json()], [200, { status: "appeared_processed" }]);
  assert.equal(chislo(kartochka, "sendMessage"), 2, "новая карточка");
  assert.notEqual(callMessages[NOMER_V_KARTOCHKE], zhivaya, "слот номера занят сессией E-B");
  assert.equal(callMessages[NOMER_V_KARTOCHKE]?.entryId, "E-B");
  assert.match(kartochka.poslednyaya(), /ВХОДЯЩИЙ ЗВОНОК/);
  assert.deepEqual(callMessages[NOMER_V_KARTOCHKE].callData.managers, ["Гена"], "маршрут нового звонка свой");
  assert.deepEqual(zhivaya.callData.managers, ["Мякинина"], "маршрут сессии E-Z не тронут: это не дозвон");
  assert.equal(otlozhennyeSessii.get("E-Z")?.session, zhivaya, "сессия E-Z отложена, а не потеряна");
});

test("р) вытесненная сессия звонка без итога: на номере висит сессия E-A с настоящей карточкой, живой Appeared E-B берёт слот и отправляет свою карточку; итог E-A правит ЕЁ карточку, а не рисует новую, и сессию E-B не трогает; итог E-B закрывает E-B", async (t) => {
  podgotovit(t);
  const kartochki = botSNomerami();
  const { otpravit, otpravitItog } = await prilozhenie(t, { botDlyaKarto4ki: kartochki.bot });
  // сессия E-A как у живого звонка: карточка уже отправлена в Telegram (у неё есть message_id), итога ещё не было
  const zabytaya = {
    card: new CallCard(TELEGRAM_CHAT_ID),
    entryId: "E-A",
    crmPhase: null,
    foundInfoList: [],
    createdAppealId: null,
    errorNote: null,
    finished: false,
    callData: { formattedFromNumber: NOMER_V_KARTOCHKE, lineName: "Линия", managers: ["Гена"], acceptedManager: null, managerLegs: [], currentLegIndex: -1 },
  };
  await zabytaya.card.sync(kartochki.bot, renderCallCard(zabytaya));
  const kartochkaA = zabytaya.card.messageId;
  assert.ok(kartochkaA, "у сессии E-A есть карточка");
  assert.equal(chislo(kartochki, "sendMessage"), 1);
  callMessages[NOMER_V_KARTOCHKE] = zabytaya;

  // новый звонок E-B с того же номера
  const appearedB = await otpravit(sobytieZvonka("Appeared", "abonent", { entry_id: "E-B", call_id: "C-B", timestamp: 1760700500 }));
  await peredacha();
  assert.deepEqual([appearedB.statusCode, appearedB.json()], [200, { status: "appeared_processed" }], "новый звонок, а не дозвон по чужой сессии");
  const sessiyaB = callMessages[NOMER_V_KARTOCHKE];
  assert.notEqual(sessiyaB, zabytaya, "слот номера занят сессией E-B");
  assert.equal(sessiyaB.entryId, "E-B");
  assert.equal(otlozhennyeSessii.get("E-A")?.session, zabytaya, "сессия E-A отложена, а не потеряна");
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новая карточка E-B");
  const kartochkaB = sessiyaB.card.messageId;
  assert.notEqual(kartochkaB, kartochkaA);
  assert.deepEqual(zabytaya.callData.managers, ["Гена"], "сессию E-A не правили");
  const tekstB = kartochki.tekst(kartochkaB);

  // итог E-A правит карточку E-A (editMessageText по её message_id), новых сообщений нет, сессия E-B на месте
  const itogA = await otpravitItog(itogZvonka({ entry_id: "E-A", call_id: "C-A" }));
  assert.deepEqual([itogA.statusCode, itogA.json()], [200, { status: "summary_sent" }]);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "итог E-A не завёл третье сообщение");
  assert.deepEqual([kartochki.zapisi.at(-1).vid, kartochki.zapisi.at(-1).id], ["editMessageText", kartochkaA], "правка ушла в карточку E-A");
  assert.match(kartochki.tekst(kartochkaA), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(zabytaya.finished, true);
  assert.equal(kartochki.tekst(kartochkaB), tekstB, "карточка E-B итогом E-A не тронута");
  assert.equal(callMessages[NOMER_V_KARTOCHKE], sessiyaB, "сессию E-B итог E-A не удалил");
  assert.equal(sessiyaB.finished, false);
  assert.equal(sessiyaB.callData.timing, undefined, "данные итога E-A в сессию E-B не попали");
  assert.equal(otlozhennyeSessii.size, 0, "использованная отложенная сессия E-A убрана");

  // итог E-B закрывает E-B правкой её же карточки
  const itogB = await otpravitItog(itogZvonka({ entry_id: "E-B", call_id: "C-B" }));
  assert.deepEqual([itogB.statusCode, itogB.json()], [200, { status: "summary_sent" }]);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новых сообщений нет");
  assert.equal(kartochki.zapisi.at(-1).id, kartochkaB, "правка ушла в карточку E-B");
  assert.match(kartochki.tekst(kartochkaB), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(sessiyaB.finished, true);
  assert.deepEqual(Object.keys(callMessages), []);
  assert.equal(otlozhennyeSessii.size, 0);
});

test("с) два плеча одного звонка (один entry_id, разные call_id) остаются дозвоном: одна карточка, маршрут дописан, итог закрывает её же", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const { otpravit, otpravitItog } = await prilozhenie(t, { botDlyaKarto4ki: kartochka.bot });

  assert.equal((await otpravit(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }))).json().status, "appeared_processed");
  assert.equal((await otpravit(sobytieZvonka("Disconnected", "abonent", { timestamp: 1760700020 }))).json().status, "disconnected");
  const vtoroe = sobytieZvonka("Appeared", "abonent", { call_id: "C-1103", timestamp: 1760700021, to: { number: "gleb", line_number: LINIYA } });
  const otvet = await otpravit(vtoroe);
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { status: "dialout_processed" }], "то же entry_id — дозвон второму менеджеру");
  assert.match(kartochka.poslednyaya(), /Гена → Мякинина/);
  assert.equal(chislo(kartochka, "sendMessage"), 1, "одна карточка на звонок");
  assert.equal(callMessages[NOMER_V_KARTOCHKE].entryId, "E-1102");

  assert.equal((await otpravitItog(ITOG_ZVONKA)).json().status, "summary_sent");
  assert.equal(chislo(kartochka, "sendMessage"), 1, "итог правит ту же карточку");
  assert.match(kartochka.poslednyaya(), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.deepEqual(Object.keys(callMessages), []);
});

test("т) Connected@abonent и Disconnected@abonent другого звонка (другой entry_id) чужую сессию не меняют; события своего звонка меняют", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const kak = { botDlyaKarto4ki: kartochka.bot };

  await vyzvat(sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 }), kak);
  const sessiya = callMessages[NOMER_V_KARTOCHKE];
  const vyzovovDo = kartochka.vyzovy.length;
  const tekstDo = kartochka.poslednyaya();

  const chuzhoy = { entry_id: "E-X", call_id: "C-X" };
  const connected = await vyzvat(sobytieZvonka("Connected", "abonent", { ...chuzhoy, timestamp: 1760700010 }), kak);
  assert.deepEqual([connected.kod, connected.telo], [200, { status: "connected" }]);
  const disconnected = await vyzvat(sobytieZvonka("Disconnected", "abonent", { ...chuzhoy, timestamp: 1760700020 }), kak);
  assert.deepEqual([disconnected.kod, disconnected.telo], [200, { status: "disconnected" }]);
  assert.equal(sessiya.callData.acceptedManager, null, "чужой Connected звонок не принял");
  assert.deepEqual([sessiya.callData.managerLegs[0].answered, sessiya.callData.managerLegs[0].endedAt], [false, null], "плечо не тронуто");
  assert.equal(kartochka.vyzovy.length, vyzovovDo, "карточка не правилась");
  assert.equal(kartochka.poslednyaya(), tekstDo);

  // Connected своего звонка (тот же entry_id) сессию меняет
  await vyzvat(sobytieZvonka("Connected", "abonent", { timestamp: 1760700011 }), kak);
  assert.equal(sessiya.callData.acceptedManager, "Гена");
  assert.equal(sessiya.callData.managerLegs[0].answered, true);
  assert.match(kartochka.poslednyaya(), /Принят/);
});

// ---------------------------------------------------------------------------------------------
// Перезвон внахлёст: пока итог первого звонка не пришёл, с того же номера (или со скрытого — у всех один ключ
// «Неизвестный номер») приходит живой Appeared второго. Телефон — индекс «последняя сессия»; события каждого звонка
// находят СВОЮ сессию по entry_id: вытесненная с номера сессия лежит среди отложенных.
// ---------------------------------------------------------------------------------------------

const NEIZVESTNYY_NOMER = "Неизвестный номер";
// Событие abonent звонка № nomer (entry_id E-nomer, call_id C-nomer, по умолчанию к Гене).
const sobytieNomer = (nomer, sostoyanie, polya = {}) =>
  sobytieZvonka(sostoyanie, "abonent", { entry_id: `E-${nomer}`, call_id: `C-${nomer}`, ...polya });
const itogNomer = (nomer, polya = {}) => itogZvonka({ entry_id: `E-${nomer}`, call_id: `C-${nomer}`, ...polya });

// Бот с отдельным message_id у каждой карточки: видно, какую карточку правит editMessageText.
function botSNomerami() {
  const zapisi = []; // по порядку: { vid: "sendMessage" | "editMessageText", id, tekst }
  const vyzovy = [];
  let posledniyId = 500;
  const bot = new Proxy(
    {},
    {
      get: (_, imya) => async (...args) => {
        vyzovy.push(String(imya));
        if (imya === "sendMessage") {
          posledniyId += 1;
          zapisi.push({ vid: "sendMessage", id: posledniyId, tekst: String(args[1]) });
          return { message_id: posledniyId };
        }
        if (imya === "editMessageText") zapisi.push({ vid: "editMessageText", id: args[1].message_id, tekst: String(args[0]) });
        return { message_id: 0 };
      },
    },
  );
  return { bot, zapisi, vyzovy, tekst: (id) => zapisi.filter((z) => z.id === id).at(-1)?.tekst || "" };
}

// Ждём по часам: карточка Telegram правится не чаще раза в 250 мс, тиков setImmediate до этого не хватит.
async function dozhdatsyaPoVremeni(uslovie, limitMs = 5000) {
  for (let proshlo = 0; proshlo < limitMs && !uslovie(); proshlo += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(uslovie(), "не дождались условия");
}

// Общий ход «перезвон внахлёст» для обычного и скрытого номера: ot — from событий, klyuch — ключ слота в callMessages.
async function perezvonVnakhlest(t, { ot, klyuch }) {
  podgotovit(t);
  const kartochki = botSNomerami();
  const kak = { botDlyaKarto4ki: kartochki.bot };

  // Звонок E-1: живая сессия с карточкой, итога ещё нет
  await vyzvat(sobytieNomer(1, "Appeared", { from: ot, timestamp: 1760700005 }), kak);
  const sessiya1 = callMessages[klyuch];
  assert.equal(sessiya1?.entryId, "E-1");
  assert.equal(chislo(kartochki, "sendMessage"), 1);
  const kartochka1 = sessiya1.card.messageId;

  // С того же номера приходит живой Appeared E-2: новая карточка, E-1 отложена, слот номера у E-2
  const appeared2 = await vyzvat(sobytieNomer(2, "Appeared", { from: ot, timestamp: 1760700008 }), kak);
  assert.deepEqual([appeared2.kod, appeared2.telo], [200, { status: "appeared_processed" }]);
  const sessiya2 = callMessages[klyuch];
  assert.equal(sessiya2?.entryId, "E-2");
  assert.notEqual(sessiya2, sessiya1);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "для E-2 отправлена новая карточка");
  const kartochka2 = sessiya2.card.messageId;
  assert.notEqual(kartochka2, kartochka1);
  assert.equal(otlozhennyeSessii.get("E-1")?.session, sessiya1, "сессия E-1 отложена, а не удалена");
  const tekstE2 = kartochki.tekst(kartochka2);

  // Connected и Disconnected@abonent звонка E-1 правят карточку E-1, а не E-2
  const pravokDo = chislo(kartochki, "editMessageText");
  assert.equal((await vyzvat(sobytieNomer(1, "Connected", { from: ot, timestamp: 1760700010 }), kak)).telo.status, "connected");
  assert.equal(sessiya1.callData.acceptedManager, "Гена", "E-1 принят");
  assert.ok(chislo(kartochki, "editMessageText") > pravokDo, "карточка отредактирована");
  assert.equal(kartochki.zapisi.at(-1).id, kartochka1, "правка ушла в карточку E-1");
  assert.match(kartochki.tekst(kartochka1), /Принят/);
  assert.equal((await vyzvat(sobytieNomer(1, "Disconnected", { from: ot, timestamp: 1760700020 }), kak)).telo.status, "disconnected");
  assert.equal(sessiya1.callData.managerLegs[0].endedAt, 1760700010, "плечо E-1 закрыто на Connected");
  assert.equal(sessiya2.callData.acceptedManager, null, "E-2 чужой Connected не принял");
  assert.deepEqual([sessiya2.callData.managerLegs[0].answered, sessiya2.callData.managerLegs[0].endedAt], [false, null], "плечо E-2 не тронуто");
  assert.equal(kartochki.tekst(kartochka2), tekstE2, "карточка E-2 не менялась");

  // Итог E-1 редактирует карточку E-1: сообщений не прибавилось, слот номера у E-2, отложенная сессия убрана
  const itog1 = await vyzvat(itogNomer(1, { from: ot }), kak);
  assert.deepEqual([itog1.kod, itog1.telo], [200, { status: "summary_sent" }]);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "итог E-1 не завёл третье сообщение");
  assert.equal(kartochki.zapisi.at(-1).id, kartochka1);
  assert.match(kartochki.tekst(kartochka1), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(kartochki.tekst(kartochka2), tekstE2, "карточка E-2 итогом E-1 не тронута");
  assert.equal(callMessages[klyuch], sessiya2, "слот номера по-прежнему у E-2");
  assert.equal(otlozhennyeSessii.size, 0, "использованная отложенная сессия убрана");

  // Итог E-2 редактирует карточку E-2; в конце ничего не осталось
  const itog2 = await vyzvat(itogNomer(2, { from: ot }), kak);
  assert.deepEqual([itog2.kod, itog2.telo], [200, { status: "summary_sent" }]);
  assert.equal(chislo(kartochki, "sendMessage"), 2);
  assert.equal(kartochki.zapisi.at(-1).id, kartochka2);
  assert.match(kartochki.tekst(kartochka2), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.deepEqual(Object.keys(callMessages), []);
  assert.equal(otlozhennyeSessii.size, 0);
}

test("у) перезвон внахлёст: у E-1 живая сессия, с того же номера приходит живой Appeared E-2 — у E-2 своя карточка, Connected, Disconnected и итог E-1 правят карточку E-1, итог E-2 — карточку E-2", async (t) => {
  await perezvonVnakhlest(t, { ot: { number: TELEFON }, klyuch: NOMER_V_KARTOCHKE });
});

test("ф) второе плечо E-1 после того как E-2 занял слот номера: Appeared@abonent E-1 с другим менеджером идёт дозвоном на отложенную сессию E-1, карточка E-2 не меняется", async (t) => {
  podgotovit(t);
  const kartochki = botSNomerami();
  const kak = { botDlyaKarto4ki: kartochki.bot };

  await vyzvat(sobytieNomer(1, "Appeared", { timestamp: 1760700005 }), kak);
  const sessiya1 = callMessages[NOMER_V_KARTOCHKE];
  await vyzvat(sobytieNomer(2, "Appeared", { timestamp: 1760700008 }), kak);
  const sessiya2 = callMessages[NOMER_V_KARTOCHKE];
  assert.equal(sessiya2.entryId, "E-2");
  assert.equal(chislo(kartochki, "sendMessage"), 2);
  const tekstE2 = kartochki.tekst(sessiya2.card.messageId);

  // первый менеджер E-1 не ответил, звонок уходит второму: тот же entry_id, другой call_id
  const vtoroe = await vyzvat(
    sobytieNomer(1, "Appeared", { call_id: "C-1b", timestamp: 1760700021, to: { number: "gleb", line_number: LINIYA } }),
    kak,
  );
  assert.deepEqual([vtoroe.kod, vtoroe.telo], [200, { status: "dialout_processed" }], "дозвон, а не новый звонок");
  assert.deepEqual(sessiya1.callData.managers, ["Гена", "Мякинина"], "маршрут E-1 дополнен вторым менеджером");
  assert.match(kartochki.tekst(sessiya1.card.messageId), /Гена → Мякинина/);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новых сообщений нет");
  assert.deepEqual(sessiya2.callData.managers, ["Гена"], "маршрут E-2 не менялся");
  assert.equal(kartochki.tekst(sessiya2.card.messageId), tekstE2, "карточка E-2 не менялась");
  assert.equal(callMessages[NOMER_V_KARTOCHKE], sessiya2, "слот номера по-прежнему у E-2");
  assert.equal(otlozhennyeSessii.get("E-1")?.session, sessiya1);
});

test("х) скрытый номер: два одновременных звонка с одним ключом «Неизвестный номер» ведут себя как при перезвоне внахлёст — у каждого своя карточка, события и итог находят свою сессию по entry_id", async (t) => {
  // пустой from.number, как у скрытого номера: formatPhoneNumber превращает его в «Неизвестный номер»
  await perezvonVnakhlest(t, { ot: { number: "" }, klyuch: NEIZVESTNYY_NOMER });
});

// ---------------------------------------------------------------------------------------------
// Итог забрал сессию, пока Appeared нового клиента ещё искал клиента или вставлял заявку: заявка заводится позже, чем
// итоговая карточка нарисована, и номер заявки надо дописать на карточку.
// ---------------------------------------------------------------------------------------------

test("ц) итог забрал сессию, пока Appeared нового клиента ищет клиента, а вставка заявки падает → 503 late_appeal_failed, метка звонка снята; повтор того же Appeared после снятия сбоя заводит заявку", async (t) => {
  podgotovit(t);
  const kartochka = botSTekstom();
  const kak = { botDlyaKarto4ki: kartochka.bot };
  let otkrytVorota;
  baza.vorota = new Promise((resolve) => {
    otkrytVorota = resolve;
  });
  baza.oshibkaVstavki = { message: "insert failed", code: "XX000" };

  const appeared = sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 });
  const appearedZhdet = vyzvat(appeared, kak);
  await dozhdatsya(() => baza.uVorot > 0);
  assert.equal(activeCalls[NOMER_ZVONKA.call_id], true, "метка звонка стоит, пока идёт поиск");
  assert.equal((await vyzvat(ITOG_ZVONKA, kak)).telo.status, "summary_sent");
  assert.deepEqual(Object.keys(callMessages), [], "итог забрал сессию");

  otkrytVorota();
  const sboy = await appearedZhdet;
  assert.deepEqual([sboy.kod, sboy.telo], [503, { error: "late_appeal_failed" }]);
  assert.equal(activeCalls[NOMER_ZVONKA.call_id], undefined, "метка звонка снята перед 503");
  assert.equal(zapisiBazy("appeals.insert").length, 1, "вставку пробовали один раз");

  baza.oshibkaVstavki = null;
  const povtor = await vyzvat(appeared, kak);
  assert.deepEqual([povtor.kod, povtor.telo], [200, { status: "appeared_late_appeal_created" }], "повтор проходит и заводит заявку");
  assert.equal(zapisiBazy("appeals.insert").length, 2);
  assert.deepEqual(Object.keys(activeCalls), []);
});

test("ч) текст после поздней заявки: итог забрал сессию во время поиска клиента (и во время вставки заявки) — последний текст карточки содержит «Создана новая заявка» и её номер", async (t) => {
  podgotovit(t);
  const propushchen = itogZvonka({ entry_result: 0 }); // итог пропущенного звонка без заявки: «Клиент не найден в базе, заявка не создавалась»
  const appeared = sobytieZvonka("Appeared", "abonent", { timestamp: 1760700005 });

  // во время поиска клиента (ворота на поиске, как в тесте «о»)
  const poisk = botSTekstom();
  let otkrytPoisk;
  baza.vorota = new Promise((resolve) => {
    otkrytPoisk = resolve;
  });
  const poiskZhdet = vyzvat(appeared, { botDlyaKarto4ki: poisk.bot });
  await dozhdatsya(() => baza.uVorot > 0);
  await vyzvat(propushchen, { botDlyaKarto4ki: poisk.bot });
  assert.match(poisk.poslednyaya(), /Клиент не найден в базе, заявка не создавалась/, "итог нарисован до того, как завели заявку");
  otkrytPoisk();
  const otvetPoiska = await poiskZhdet;
  assert.deepEqual([otvetPoiska.kod, otvetPoiska.telo], [200, { status: "appeared_late_appeal_created" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 1);
  assert.match(poisk.poslednyaya(), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.match(poisk.poslednyaya(), /Создана новая заявка[\s\S]*A-100/, "номер заявки дописан на карточку итога");
  assert.doesNotMatch(poisk.poslednyaya(), /заявка не создавалась/);
  assert.equal(chislo(poisk, "sendMessage"), 1, "всё на одной карточке");

  // во время вставки заявки (ворота на вставке)
  sbrositSostoyanie();
  const vstavka = botSTekstom();
  let otkrytVstavku;
  baza.vorotaVstavki = new Promise((resolve) => {
    otkrytVstavku = resolve;
  });
  const vstavkaZhdet = vyzvat(appeared, { botDlyaKarto4ki: vstavka.bot });
  await dozhdatsyaPoVremeni(() => baza.uVorotVstavki > 0);
  await vyzvat(propushchen, { botDlyaKarto4ki: vstavka.bot });
  assert.deepEqual(Object.keys(callMessages), [], "итог забрал сессию");
  assert.match(vstavka.poslednyaya(), /Клиент не найден в базе, заявка не создавалась/);
  otkrytVstavku();
  const otvetVstavki = await vstavkaZhdet;
  assert.deepEqual([otvetVstavki.kod, otvetVstavki.telo], [200, { status: "appeared_processed" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 1);
  assert.match(vstavka.poslednyaya(), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.match(vstavka.poslednyaya(), /Создана новая заявка[\s\S]*A-100/, "номер заявки дописан на карточку итога");
  assert.doesNotMatch(vstavka.poslednyaya(), /заявка не создавалась/);
  assert.equal(chislo(vstavka, "sendMessage"), 1);
});

// ---------------------------------------------------------------------------------------------
// Сессию вытеснил не итог, а другой ЗВОНОК с того же номера, пока Appeared первого звонка ещё искал клиента: сессия E-1 уходит
// в отложенные (finished остаётся false), а её карточка до конца звонка висела бы «Ищу по базам…». Результат поиска
// (найденная история или заведённая заявка) дописывается в СВОЮ сессию и на СВОЮ карточку.
// ---------------------------------------------------------------------------------------------

// Общий ход: Appeared E-1 держится на воротах поиска, Appeared E-2 с того же номера берёт слот и доводит свою карточку до конца
// (ворота держат только поиск E-1: он уже на них, поиск E-2 идёт мимо). Возвращает всё, что нужно дальше.
async function vytesnenieVoVremyaPoiska(t, { klientNaiden = false } = {}) {
  podgotovit(t);
  baza.klientNaiden = klientNaiden;
  const kartochki = botSNomerami();
  const kak = { botDlyaKarto4ki: kartochki.bot };
  let otkrytVorota;
  baza.vorota = new Promise((resolve) => {
    otkrytVorota = resolve;
  });
  const appeared1Zhdet = vyzvat(sobytieNomer(1, "Appeared", { timestamp: 1760700005 }), kak);
  await dozhdatsya(() => baza.uVorot > 0);
  baza.vorota = null;
  const sessiya1 = callMessages[NOMER_V_KARTOCHKE];
  assert.equal(sessiya1?.entryId, "E-1");
  const kartochka1 = sessiya1.card.messageId;
  assert.ok(kartochka1, "карточка E-1 уже отправлена");
  assert.match(kartochki.tekst(kartochka1), /Ищу/, "пока ворота закрыты, карточка E-1: «Ищу по базам…»");

  // с того же номера приходит Appeared E-2: слот номера у него, сессия E-1 отложена; E-2 доводит свою карточку до конца
  const appeared2 = await vyzvat(sobytieNomer(2, "Appeared", { timestamp: 1760700008 }), kak);
  assert.deepEqual([appeared2.kod, appeared2.telo], [200, { status: "appeared_processed" }]);
  const sessiya2 = callMessages[NOMER_V_KARTOCHKE];
  assert.equal(sessiya2?.entryId, "E-2");
  assert.equal(otlozhennyeSessii.get("E-1")?.session, sessiya1, "сессия E-1 отложена, а не удалена");
  assert.equal(sessiya1.finished, false);
  const kartochka2 = sessiya2.card.messageId;
  assert.notEqual(kartochka2, kartochka1);
  assert.equal(chislo(kartochki, "sendMessage"), 2);
  assert.match(kartochki.tekst(kartochka1), /Ищу/, "карточка E-1 всё ещё «Ищу по базам…»");

  return { kartochki, kak, sessiya1, sessiya2, kartochka1, kartochka2, tekstE2: kartochki.tekst(kartochka2), otkrytVorota, appeared1Zhdet };
}

// Итоги обоих звонков: каждый правит свою карточку, в конце не остаётся ни сессий, ни отложенных.
async function itogiObeikhZvonkov({ kartochki, kak, sessiya2, kartochka1, kartochka2 }) {
  assert.equal((await vyzvat(itogNomer(1), kak)).telo.status, "summary_sent");
  assert.equal(kartochki.zapisi.at(-1).id, kartochka1, "итог E-1 правит карточку E-1");
  assert.match(kartochki.tekst(kartochka1), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(callMessages[NOMER_V_KARTOCHKE], sessiya2, "слот номера по-прежнему у E-2");
  assert.equal(otlozhennyeSessii.size, 0, "использованная отложенная сессия убрана");
  assert.equal((await vyzvat(itogNomer(2), kak)).telo.status, "summary_sent");
  assert.equal(kartochki.zapisi.at(-1).id, kartochka2, "итог E-2 правит карточку E-2");
  assert.match(kartochki.tekst(kartochka2), /ЗАВЕРШЁННЫЙ ЗВОНОК/);
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новых сообщений нет");
  assert.deepEqual(Object.keys(callMessages), []);
  assert.equal(otlozhennyeSessii.size, 0);
}

test("ш) звонок E-2 вытеснил сессию E-1 во время поиска клиента, клиента нет: заявку заводит обработчик E-1 и дописывает номер на карточку E-1; карточка E-2 не меняется; после итогов сессий нет", async (t) => {
  const x = await vytesnenieVoVremyaPoiska(t);
  const { kartochki, sessiya1, kartochka1, kartochka2, tekstE2 } = x;
  assert.match(tekstE2, /Создана новая заявка[\s\S]*A-100/, "E-2 завёл заявку на своей карточке");
  assert.equal(zapisiBazy("appeals.insert").length, 1, "пока вставила только заявка E-2");

  // ворота открываются: поиск E-1 вернулся пустым, слот занят E-2 — заявку заводит этот же обработчик без новой карточки
  x.otkrytVorota();
  const appeared1 = await x.appeared1Zhdet;
  assert.deepEqual([appeared1.kod, appeared1.telo], [200, { status: "appeared_late_appeal_created" }]);
  assert.equal(zapisiBazy("appeals.insert").length, 2, "заявка E-1 заведена (в тестовой базе вставка не сохраняется, повторный поиск её не видит)");
  assert.equal(sessiya1.createdAppealId, "A-100");
  assert.equal(sessiya1.crmPhase, "appeal_created");
  assert.equal(sessiya1.finished, false);
  assert.match(kartochki.tekst(kartochka1), /Создана новая заявка[\s\S]*A-100/, "на карточке E-1 номер заявки");
  assert.doesNotMatch(kartochki.tekst(kartochka1), /Ищу|Создаю/, "«Ищу по базам…» с карточки E-1 ушло");
  assert.equal(kartochki.tekst(kartochka2), tekstE2, "карточка E-2 не изменилась");
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новых сообщений нет");

  await itogiObeikhZvonkov(x);
  assert.match(kartochki.tekst(kartochka1), /Создана новая заявка[\s\S]*A-100/, "номер заявки остался на карточке E-1 и после итога");
  assert.doesNotMatch(kartochki.tekst(kartochka1), /заявка не создавалась/);
});

test("щ) звонок E-2 вытеснил сессию E-1 во время поиска клиента, клиент найден: на карточке E-1 история клиента; заявки нет; карточка E-2 не меняется; после итогов сессий нет", async (t) => {
  const x = await vytesnenieVoVremyaPoiska(t, { klientNaiden: true });
  const { kartochki, sessiya1, kartochka1, kartochka2, tekstE2 } = x;
  assert.match(tekstE2, /История клиента \(1 запись\)/, "E-2 нашёл клиента сразу");

  x.otkrytVorota();
  const appeared1 = await x.appeared1Zhdet;
  assert.deepEqual([appeared1.kod, appeared1.telo], [200, { status: "appeared_processed" }]);
  assert.equal(sessiya1.foundInfoList.length, 1);
  assert.equal(sessiya1.crmPhase, "found");
  assert.equal(sessiya1.finished, false);
  assert.match(kartochki.tekst(kartochka1), /История клиента \(1 запись\)/);
  assert.match(kartochki.tekst(kartochka1), /A-7/);
  assert.doesNotMatch(kartochki.tekst(kartochka1), /Ищу/, "«Ищу по базам…» с карточки E-1 ушло");
  assert.equal(kartochki.tekst(kartochka2), tekstE2, "карточка E-2 не изменилась");
  assert.equal(chislo(kartochki, "sendMessage"), 2, "новых сообщений нет");
  assert.deepEqual(zapisiBazy("appeals.insert"), [], "клиент найден обоими — заявок нет");

  await itogiObeikhZvonkov(x);
  assert.match(kartochki.tekst(kartochka1), /История клиента \(1 запись\)/, "история осталась на карточке E-1 и после итога");
});
