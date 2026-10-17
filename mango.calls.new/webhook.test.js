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
  });
}
sbrositBazu();

const TELEFON = "79990001122";
const SEKRET = "SEKRET-PROKSI-d41d8cd9";
const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const MINUT = 60 * 1000;

function otvetCrm(z) {
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
const { activeCalls, callMessages, entryCallMeta } = require("./state");
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
async function vyzvat(obj, { bezTelegram } = {}) {
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
  await handleMangoWebhook(zapros, otvet, bot);
  return otvet;
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

// Приложение целиком: замок на onRequest, журнал в памяти, настоящий обработчик.
async function prilozhenie(t) {
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
  app.post(
    "/events/call",
    { bodyLimit: 1024 * 1024, onRequest: zamok, preHandler: zhurnal.preHandler, onSend: zhurnal.onSend },
    (req, res) => handleMangoWebhook(req, res, bot),
  );
  await app.ready();
  t.after(() => app.close());
  const otpravit = (obj, zagolovki = {}) =>
    app.inject({
      method: "POST",
      url: "/events/call",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-proxy-secret": SEKRET, ...zagolovki },
      payload: new URLSearchParams({ vpbx_api_key: "KLYUCH", sign: "PODPIS", json: JSON.stringify(obj) }).toString(),
    });
  return { app, pamyat, chasy, zhurnalLog, otpravit };
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

test("и) через журнал: поздний Appeared, а заявку не создали (сбой базы) → 503, строка не обработана; повтор после аренды доводит дело; Appeared по законченному звонку — тоже без Telegram", async (t) => {
  podgotovit(t);
  const { pamyat, chasy, otpravit } = await prilozhenie(t);
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

  // П6: свежий (не поздний) повтор Appeared другого звонка, который уже закончился по журналу, — тот же путь без Telegram
  sbrositBazu();
  const drugoy = { ...APPEARED, entry_id: "E-9", call_id: "C-9", from: { number: "79990003344" } };
  assert.equal((await otpravit({ ...drugoy, call_state: "Disconnected" })).statusCode, 200);
  const svezhiy = { "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() };
  const posleKontsa = await otpravit(drugoy, svezhiy);
  assert.equal(posleKontsa.json().status, "appeared_late_appeal_created");
  assert.equal(zapisiBazy("appeals.insert").length, 1);
  assert.deepEqual(vyzovyBota, []);
  assert.deepEqual(Object.keys(callMessages), [], "сессия живого звонка по законченному не заводится");
});
