"use strict";

// Сторона Render договора «прокси Mango ↔ Render»: журнал перед обработчиком /events/call и /events/summary,
// маршруты /internal/* за замком, запросы к mango_calls как у прокси. Сети и базы нет: журнал — на подделке
// клиента Supabase, запросы к mango_calls — через настоящий supabase-js с подменённым fetch (видна строка запроса).
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test mango.calls.new/marshrutyProksi.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const Fastify = require("fastify");
const { createClient } = require("@supabase/supabase-js");
const { sozdatZamok } = require("./zamokProksi");
const { registerMarshrutyProksi } = require("./marshrutyProksi");
const { klyuchSobytiya, ARENDA_MS } = require("./zhurnalSobytiy");
const { podmenaSupabase, shag, podmenaLog, peredacha, pamyatMangoEvents } = require("./podmenaSupabase");

const SEKRET = "SEKRET-PROKSI-d41d8cd9";
const NEVERNYY = "SEKRET-PROKSI-d41d8cd0";
const SEKRET_KLYUCH = "VPBX-KLYUCH-SEKRET-111";
const SEKRET_PODPIS = "PODPIS-SEKRET-222";
const TELEFON = "79990001122";
const SELECTEL_IP = "135.106.155.17";
const TREBOVAT = { MANGO_PROXY_SECRET: SEKRET, MANGO_PROXY_SECRET_REQUIRED: "1" };
const SUPABASE_URL = "https://test.supabase.co";
const NOW = Date.parse("2026-10-17T12:00:00.000Z");
const MINUT = 60 * 1000;

const SOBYTIE_CALL = {
  entry_id: "ENTRY-1",
  call_id: "CALL-1",
  seq: 3,
  call_state: "Appeared",
  location: "abonent",
  from: { number: TELEFON },
};
const SOBYTIE_CONNECTED = {
  entry_id: "ENTRY-1",
  call_id: "CALL-1",
  seq: 4,
  call_state: "Connected",
  from: { number: TELEFON },
};
const SOBYTIE_DISCONNECTED = {
  entry_id: "ENTRY-1",
  call_id: "CALL-1",
  seq: 9,
  call_state: "Disconnected",
  location: "abonent",
  from: { number: TELEFON },
};
const SOBYTIE_SUMMARY = {
  entry_id: "ENTRY-1",
  call_id: "CALL-1",
  call_direction: 1,
  from: { number: TELEFON },
  to: { number: "101" },
};

function minutNazad(n) {
  return new Date(NOW - n * MINUT).toISOString();
}

// Приложение как в server.js: formbody, два замка (старый — по секрету или адресу, новый tolkoSekret — для /internal/*),
// маршруты прокси и два маршрута Mango ({ bodyLimit, onRequest: замок, preHandler: журнал, onSend: итог }).
// otvetObrabotchika(req, reply, номерВызова) подменяет обработчик; chasy.teper — часы журнала (аренда, поздний повтор).
async function sobratPrilozhenie(t, { supabase = podmenaSupabase(), env = TREBOVAT, otvetObrabotchika, servisnyyKlyuch } = {}) {
  const app = Fastify();
  app.register(require("@fastify/formbody"));
  const zhurnalLog = podmenaLog();
  const chasy = { teper: NOW };
  // сколько запросов дошло до чтения тела (на 403 в onRequest разбор тела не начинается)
  const chtenie = { zaprosov: 0 };
  app.addHook("preParsing", async (req, reply, payload) => {
    chtenie.zaprosov += 1;
    return payload;
  });
  const zamok = sozdatZamok({ env, log: podmenaLog().log });
  const zamokSekret = sozdatZamok({ env, log: podmenaLog().log, tolkoSekret: true });
  const zhurnalSobytiy = registerMarshrutyProksi(app, zamokSekret, {
    supabase,
    log: zhurnalLog.log,
    now: () => chasy.teper,
    chistka: false,
    servisnyyKlyuch,
  });
  const obrabotchik = { vyzovy: [] };
  const handler = async (req, reply) => {
    obrabotchik.vyzovy.push({ url: req.url, body: req.body, bezTelegram: req.mangoBezTelegram === true });
    if (otvetObrabotchika) return otvetObrabotchika(req, reply, obrabotchik.vyzovy.length);
    return reply.send({ status: "handled" });
  };
  const marshrut = () => ({
    bodyLimit: 1024 * 1024,
    onRequest: zamok,
    preHandler: zhurnalSobytiy.preHandler,
    onSend: zhurnalSobytiy.onSend,
  });
  app.post("/events/call", marshrut(), handler);
  app.post("/events/summary", marshrut(), handler);
  await app.ready();
  t.after(() => app.close());
  return { app, supabase, obrabotchik, zhurnalLog, chasy, chtenie };
}

// Событие Mango, как шлёт прокси: форма vpbx_api_key / sign / json + заголовки прокси.
function sobytieMango(app, { put = "/events/call", obj = SOBYTIE_CALL, zagolovki = {}, sekret = SEKRET } = {}) {
  return app.inject({
    method: "POST",
    url: put,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(sekret ? { "x-proxy-secret": sekret } : {}),
      ...zagolovki,
    },
    payload: new URLSearchParams({
      vpbx_api_key: SEKRET_KLYUCH,
      sign: SEKRET_PODPIS,
      json: JSON.stringify(obj),
    }).toString(),
  });
}

function vnutrennee(app, metod, url, telo, { sekret = SEKRET, zagolovki = {} } = {}) {
  return app.inject({
    method: metod,
    url,
    headers: { ...(sekret ? { "x-proxy-secret": sekret } : {}), ...zagolovki },
    ...(telo === undefined ? {} : { payload: telo }),
  });
}

function vnutrenneePost(app, url, telo, parametry) {
  return vnutrennee(app, "POST", url, telo, { ...parametry, zagolovki: { "content-type": "application/json", ...parametry?.zagolovki } });
}

// Настоящий supabase-js, но вместо сети — подменённый fetch: записывает запрос, отвечает otvet(zapros).
function klientSPodmenoyiSeti(otvet) {
  const zaprosy = [];
  const podmenaFetch = async (url, init = {}) => {
    const zapros = {
      metod: init.method || "GET",
      url: new URL(String(url)),
      zagolovki: new Headers(init.headers),
      telo: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    zaprosy.push(zapros);
    const { status = 200, body } = otvet(zapros) || {};
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const klient = createClient(SUPABASE_URL, "TEST-SERVICE-ROLE-KEY", {
    global: { fetch: podmenaFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { klient, zaprosy };
}

// Запросы прокси к Supabase дословно из mango-proxy/src (репозиторий только читали).
const proksi = {
  // workers/recordingRetry.js:12-23 fetchPendingRecordings (BATCH_LIMIT = 5, MIN_AGE_SEC = 45)
  ochered(teper, limit = 5) {
    const minUpdated = new Date(teper - 45 * 1000).toISOString();
    return (
      `${SUPABASE_URL}/rest/v1/mango_calls` +
      `?select=entry_id,recording_id,recording_status,updated_at` +
      `&recording_id=not.is.null` +
      `&storage_path=is.null` +
      `&recording_status=in.(pending,failed,downloading)` +
      `&updated_at=lt.${encodeURIComponent(minUpdated)}` +
      `&order=updated_at.asc` +
      `&limit=${limit}`
    );
  },
  // services/supabase.js:11 updateCallRow, PATCH (Prefer: return=representation)
  patch: (entryId) => `${SUPABASE_URL}/rest/v1/mango_calls?entry_id=eq.${encodeURIComponent(entryId)}`,
  // services/supabase.js:24 updateCallRow, POST заготовки (Prefer: return=minimal)
  vstavka: () => `${SUPABASE_URL}/rest/v1/mango_calls`,
  // services/supabase.js:49-53 markPendingIfNotReady, GET
  vyborka(entryId) {
    return (
      `${SUPABASE_URL}/rest/v1/mango_calls` +
      `?select=recording_status,storage_path` +
      `&entry_id=eq.${encodeURIComponent(entryId)}` +
      `&limit=1`
    );
  },
};

// Тот же адрес, путь и параметры запроса в том же порядке (после разбора процентного кодирования).
function utverditTotZhe(fakt, ozhidaemyy, { bez = [] } = {}) {
  const f = new URL(String(fakt));
  const o = new URL(ozhidaemyy);
  assert.equal(f.origin, o.origin);
  assert.equal(f.pathname, o.pathname);
  const pary = (u) => [...u.searchParams].filter(([k]) => !bez.includes(k));
  assert.deepEqual(pary(f), pary(o));
}

// Боевой сбой: or-фильтр на update ломал PostgREST (42703). В запросах к базе только простые фильтры: ни or=, ни and=.
function utverditBezOr(zaprosy) {
  assert.ok(zaprosy.length > 0, "запросов к базе не было — проверять нечего");
  for (const z of zaprosy) {
    assert.ok(!z.url.searchParams.has("or") && !z.url.searchParams.has("and"), `в запросе ${z.metod} ${z.url.search} есть or=/and=`);
    assert.ok(!/(^|[?&])(or|and)=/.test(z.url.search), `в строке запроса ${z.url.search} есть or=/and=`);
  }
}

function tekstZhurnala(zhurnalLog) {
  return JSON.stringify(zhurnalLog.zapisi);
}

function utverditChistyyZhurnal(zhurnalLog) {
  const tekst = tekstZhurnala(zhurnalLog);
  for (const sekretnoe of [TELEFON, SEKRET_KLYUCH, SEKRET_PODPIS, SEKRET, NEVERNYY]) {
    assert.ok(!tekst.includes(sekretnoe), `в журнал логов попало ${sekretnoe}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Журнал перед обработчиком /events/call и /events/summary
// ---------------------------------------------------------------------------------------------

test("а) новое событие: запись в mango_events до обработчика, обработчик один раз, его ответ уходит как есть", async (t) => {
  const { app, supabase, obrabotchik } = await sobratPrilozhenie(t);
  const otvet = await sobytieMango(app, {
    zagolovki: { "x-mango-prinyato": minutNazad(1), "x-mango-podpis": "ok" },
  });

  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { status: "handled" });
  assert.equal(obrabotchik.vyzovy.length, 1);
  assert.equal(JSON.parse(obrabotchik.vyzovy[0].body.json).entry_id, "ENTRY-1", "обработчик получил тело Mango без изменений");
  await peredacha();

  assert.equal(supabase.zaprosy.length, 2, "запись события и отметка итога ответа");
  const [stroka, parametry] = shag(supabase.zaprosy[0], "upsert");
  assert.equal(supabase.zaprosy[0].tablitsa, "mango_events");
  assert.deepEqual(parametry, { onConflict: "klyuch", ignoreDuplicates: true });
  assert.equal(stroka.klyuch, klyuchSobytiya("/events/call", JSON.stringify(SOBYTIE_CALL)));
  assert.equal(stroka.vid, "call");
  assert.equal(stroka.sobytie, "Appeared@abonent");
  assert.equal(stroka.podpis, "ok");
  assert.equal(stroka.povtor, false);
  assert.equal(stroka.prinyato, minutNazad(1));
  assert.ok(!JSON.stringify(stroka).includes(SEKRET_KLYUCH) && !JSON.stringify(stroka).includes(SEKRET_PODPIS));
  // итог ответа обработчика: по id строки, которую вернула вставка
  assert.equal(supabase.zaprosy[1].tablitsa, "mango_events");
  assert.deepEqual(shag(supabase.zaprosy[1], "update"), [{ obrabotano: true, kod: 200 }]);
  assert.deepEqual(shag(supabase.zaprosy[1], "eq"), ["id", 1]);
});

test("а2) настоящий supabase-js: запись POST mango_events?on_conflict=klyuch (ignore-duplicates), поиск старой строки, итог PATCH по id", async (t) => {
  // json со знаками, которые портит небрежное разбирание формы: кириллица, +, &, %, =, перевод строки
  const objSoZnakami = { entry_id: "E+1/=", call_id: "C&%25", call_state: "Appeared", location: "abonent", note: "привет + мир\n= 100%" };
  const strokaJson = JSON.stringify(objSoZnakami);
  const klyuch = klyuchSobytiya("/events/call", strokaJson);

  // база по-настоящему: 1-я вставка новая (id 41), 2-я — ключ уже есть (пусто), 3-я — сбой; поиск старой строки: уже обработано
  let vstavok = 0;
  const { klient, zaprosy } = klientSPodmenoyiSeti((z) => {
    if (z.metod === "PATCH") return { status: 204 };
    if (z.metod === "GET") return { body: [{ id: 41, obrabotano: true }] };
    vstavok += 1;
    if (vstavok === 1) return { status: 201, body: [{ id: 41 }] };
    if (vstavok === 2) return { status: 201, body: [] };
    return { status: 503, body: { message: "upstream down", code: "PGRST000" } };
  });
  const { app, obrabotchik, zhurnalLog } = await sobratPrilozhenie(t, { supabase: klient });

  const novoe = await sobytieMango(app, { obj: objSoZnakami });
  await peredacha();
  const dubl = await sobytieMango(app, { obj: objSoZnakami });
  const sboy = await sobytieMango(app, { obj: objSoZnakami });
  await peredacha();

  assert.deepEqual(novoe.json(), { status: "handled" });
  assert.deepEqual(dubl.json(), { ok: true, duplicate: true });
  assert.deepEqual(sboy.json(), { status: "handled" }, "сбой базы — обработчик всё равно зовётся");
  assert.equal(obrabotchik.vyzovy.length, 2);
  assert.equal(zhurnalLog.zapisi.filter((z) => z.uroven === "error").length, 1);
  utverditChistyyZhurnal(zhurnalLog);

  utverditBezOr(zaprosy);
  const vstavki = zaprosy.filter((z) => z.metod === "POST");
  assert.equal(vstavki.length, 3);
  for (const z of vstavki) {
    assert.equal(z.url.pathname, "/rest/v1/mango_events");
    assert.deepEqual([...z.url.searchParams], [["on_conflict", "klyuch"], ["select", "id"]]);
    // INSERT ... ON CONFLICT (klyuch) DO NOTHING RETURNING id
    assert.equal(z.zagolovki.get("prefer"), "resolution=ignore-duplicates,return=representation");
    // строка json дошла до ключа ровно такой, как была отправлена: через форму и formbody без потерь
    assert.equal(z.telo.klyuch, klyuch);
    assert.deepEqual(z.telo.payload, objSoZnakami);
    assert.equal(z.telo.vzyato, new Date(NOW).toISOString(), "новая строка сразу в аренде");
  }
  // поиск старой строки при дубле: select id,obrabotano ... where klyuch = ... limit 1
  const poiski = zaprosy.filter((z) => z.metod === "GET");
  assert.equal(poiski.length, 1);
  assert.equal(poiski[0].url.pathname, "/rest/v1/mango_events");
  assert.deepEqual([...poiski[0].url.searchParams], [["select", "id,obrabotano,vzyato"], ["klyuch", `eq.${klyuch}`], ["limit", "1"]]);
  // итог ответа обработчика первого запроса: update mango_events set obrabotano = true, kod = 200 where id = 41 and obrabotano = false
  const itogi = zaprosy.filter((z) => z.metod === "PATCH");
  assert.equal(itogi.length, 1);
  assert.equal(itogi[0].url.pathname, "/rest/v1/mango_events");
  assert.deepEqual([...itogi[0].url.searchParams], [["id", "eq.41"], ["obrabotano", "eq.false"]]);
  assert.deepEqual(itogi[0].telo, { obrabotano: true, kod: 200 });
});

test("б) дубль: уже обработано (obrabotano=true) → 200 {ok:true,duplicate:true}, обработчик не зовётся — и для call, и для summary", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik } = await sobratPrilozhenie(t, { supabase: podmenaSupabase(pamyat.otvet) });
  const povtor = { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(1) };

  for (const [put, obj] of [
    ["/events/call", SOBYTIE_CALL],
    ["/events/summary", SOBYTIE_SUMMARY],
  ]) {
    const pervyy = await sobytieMango(app, { put, obj });
    assert.deepEqual(pervyy.json(), { status: "handled" }, put);
    await peredacha();
    const vtoroy = await sobytieMango(app, { put, obj, zagolovki: povtor });
    assert.equal(vtoroy.statusCode, 200, put);
    assert.deepEqual(vtoroy.json(), { ok: true, duplicate: true }, put);
  }
  assert.equal(obrabotchik.vyzovy.length, 2, "по одному разу на каждое событие");
  assert.equal(pamyat.stroki.length, 2);
  assert.deepEqual(pamyat.stroki.map((s) => [s.obrabotano, s.kod]), [[true, 200], [true, 200]]);
});

test("б2) обработчик ответил 5xx → строка obrabotano=false, kod=5xx → повтор (после аренды) доходит до обработчика; ответил 200 → следующий повтор — дубль", async (t) => {
  const pamyat = pamyatMangoEvents();
  const kody = [500, 200];
  const { app, obrabotchik, zhurnalLog, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: (req, reply, nomer) => reply.code(kody[nomer - 1] || 200).send({ status: "handled", nomer }),
  });
  const povtor = () => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() });

  const pervyy = await sobytieMango(app);
  await peredacha();
  assert.equal(pervyy.statusCode, 500);
  assert.equal(pamyat.stroki.length, 1);
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [false, 500], "5xx — не обработано");

  chasy.teper += ARENDA_MS + 1000;
  const vtoroy = await sobytieMango(app, { zagolovki: povtor() });
  await peredacha();
  assert.deepEqual(vtoroy.json(), { status: "handled", nomer: 2 }, "повтор дошёл до обработчика");
  assert.equal(obrabotchik.vyzovy.length, 2);
  assert.equal(pamyat.stroki.length, 1, "строка та же, новая не заводится");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);
  assert.equal(pamyat.stroki[0].vzyato, new Date(chasy.teper).toISOString(), "аренда обновлена при повторе");
  assert.equal(zhurnalLog.zapisi.filter((z) => z.uroven === "warn").length, 1, "повтор после сбоя виден в логе");
  assert.match(zhurnalLog.zapisi.find((z) => z.uroven === "warn").tekst, /\/events\/call entry=ENTRY-1: прошлый раз не обработано/);

  const tretiy = await sobytieMango(app, { zagolovki: povtor() });
  assert.deepEqual(tretiy.json(), { ok: true, duplicate: true });
  assert.equal(obrabotchik.vyzovy.length, 2, "после 200 повтор — дубль, обработчик не зовётся");
  utverditChistyyZhurnal(zhurnalLog);
});

test("б3) 4xx обработчика (например «Bad json») — это ответ, а не сбой: obrabotano=true, повтор — дубль; исключение в обработчике — 500, повтор доходит", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: (req, reply, nomer) => {
      if (nomer === 2) throw new Error("обработчик упал");
      return reply.code(nomer === 1 ? 400 : 200).send({ nomer });
    },
  });
  const povtor = () => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() });

  // 400: обработано (ответ дан), повтор бессмысленен
  assert.equal((await sobytieMango(app, { obj: SOBYTIE_CALL })).statusCode, 400);
  await peredacha();
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 400]);
  assert.deepEqual((await sobytieMango(app, { obj: SOBYTIE_CALL, zagolovki: povtor() })).json(), { ok: true, duplicate: true });
  assert.equal(obrabotchik.vyzovy.length, 1);

  // исключение: Fastify отвечает 500, строка не обработана, повтор (после аренды) доходит
  const drugoe = { ...SOBYTIE_CALL, seq: 4 };
  assert.equal((await sobytieMango(app, { obj: drugoe })).statusCode, 500);
  await peredacha();
  assert.deepEqual([pamyat.stroki[1].obrabotano, pamyat.stroki[1].kod], [false, 500]);
  chasy.teper += ARENDA_MS + 1000;
  const povtorDrugogo = await sobytieMango(app, { obj: drugoe, zagolovki: povtor() });
  await peredacha();
  assert.equal(povtorDrugogo.statusCode, 200);
  assert.equal(obrabotchik.vyzovy.length, 3);
  assert.deepEqual([pamyat.stroki[1].obrabotano, pamyat.stroki[1].kod], [true, 200]);
});

test("в) ошибка базы: в лог (без тела, телефонов, ключей) и дальше в обработчик — звонок важнее журнала", async (t) => {
  const oshibkaBazy = { message: "relation mango_events does not exist", code: "42P01", details: `row (${TELEFON})` };
  const varianty = {
    "ответ базы с ошибкой": () => ({ data: null, error: oshibkaBazy }),
    "отказ запроса": () => Promise.reject(new Error("fetch failed")),
    "клиент бросил": () => {
      throw new Error("клиент сломан");
    },
  };
  for (const [nazvanie, otvetBazy] of Object.entries(varianty)) {
    const { app, obrabotchik, zhurnalLog } = await sobratPrilozhenie(t, { supabase: podmenaSupabase(otvetBazy) });
    const otvet = await sobytieMango(app);

    assert.equal(otvet.statusCode, 200, nazvanie);
    assert.deepEqual(otvet.json(), { status: "handled" }, nazvanie);
    assert.equal(obrabotchik.vyzovy.length, 1, nazvanie);

    const oshibki = zhurnalLog.zapisi.filter((z) => z.uroven === "error");
    assert.equal(oshibki.length, 1, nazvanie);
    assert.match(oshibki[0].tekst, /\/events\/call entry=ENTRY-1/, nazvanie);
    assert.match(oshibki[0].tekst, /обрабатываем дальше/, nazvanie);
    utverditChistyyZhurnal(zhurnalLog);
  }
});

test("г) поздний повтор call (x-mango-povtor: 1, принято >10 мин назад): только запись, 200, без обработчика", async (t) => {
  const { app, supabase, obrabotchik } = await sobratPrilozhenie(t);
  const otvet = await sobytieMango(app, {
    obj: SOBYTIE_CONNECTED,
    zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(11), "x-mango-podpis": "ok" },
  });

  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { ok: true, stale: true });
  assert.equal(obrabotchik.vyzovy.length, 0);
  await peredacha();
  assert.equal(supabase.zaprosy.length, 2, "событие записано и закрыто");
  const [stroka] = shag(supabase.zaprosy[0], "upsert");
  assert.equal(stroka.povtor, true);
  assert.equal(stroka.prinyato, minutNazad(11));
  // поздний повтор — «только запись»: obrabotano=true, kod=200 (итог ответа 200 ставит onSend)
  assert.deepEqual(shag(supabase.zaprosy[1], "update"), [{ obrabotano: true, kod: 200 }]);
  assert.deepEqual(shag(supabase.zaprosy[1], "eq"), ["id", 1]);
});

test("г2) поздний повтор помечен obrabotano: и новая строка, и старая необработанная закрываются (true/200), дальше — дубль", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: (req, reply) => reply.code(500).send({ status: "sboy" }),
  });
  const pozdno = (minut) => ({ "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(minut) });

  // новая строка, сразу поздний повтор
  const novyy = await sobytieMango(app, { obj: { ...SOBYTIE_CONNECTED, seq: 7 }, zagolovki: pozdno(15) });
  await peredacha();
  assert.deepEqual(novyy.json(), { ok: true, stale: true });
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod, pamyat.stroki[0].povtor], [true, 200, true]);

  // старая необработанная: первый раз обработчик ответил 5xx, повтор пришёл спустя 11 минут (аренда давно истекла)
  assert.equal((await sobytieMango(app, { obj: SOBYTIE_CONNECTED })).statusCode, 500);
  await peredacha();
  assert.deepEqual([pamyat.stroki[1].obrabotano, pamyat.stroki[1].kod], [false, 500]);
  chasy.teper += ARENDA_MS + 1000;
  const pozdniy = await sobytieMango(app, { obj: SOBYTIE_CONNECTED, zagolovki: pozdno(11) });
  await peredacha();
  assert.deepEqual(pozdniy.json(), { ok: true, stale: true });
  assert.deepEqual([pamyat.stroki[1].obrabotano, pamyat.stroki[1].kod], [true, 200], "карточка по нему устарела — строку закрыли без обработчика");
  assert.equal(obrabotchik.vyzovy.length, 1, "обработчик был только на первый (5xx) заход");

  const dubl = await sobytieMango(app, { obj: SOBYTIE_CONNECTED, zagolovki: pozdno(12) });
  assert.deepEqual(dubl.json(), { ok: true, duplicate: true });
  assert.equal(pamyat.stroki.length, 2);
});

test("г3) ошибка записи итога: в лог без тела и секретов, ответ обработчика не страдает; обрыв поиска старой строки — как ошибка записи", async (t) => {
  const pamyat = pamyatMangoEvents();
  const oshibka = { message: "permission denied", code: "42501", details: `row (${TELEFON})` };
  const supabase = podmenaSupabase((z) => (shag(z, "update") ? { data: null, error: oshibka } : pamyat.otvet(z)));
  const { app, obrabotchik, zhurnalLog } = await sobratPrilozhenie(t, { supabase });

  const otvet = await sobytieMango(app);
  await peredacha();
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { status: "handled" }]);
  const oshibki = zhurnalLog.zapisi.filter((z) => z.uroven === "error");
  assert.equal(oshibki.length, 1);
  assert.match(oshibki[0].tekst, /\[mango_events\] id=1: итог ответа 200 не записан \(42501: permission denied\)/);
  utverditChistyyZhurnal(zhurnalLog);
  assert.equal(pamyat.stroki[0].obrabotano, false, "итог не записался — строка осталась необработанной, повтор обработается");
  assert.equal(obrabotchik.vyzovy.length, 1);

  // повтор: поиск старой строки упал → это ошибка записи: обработчик зовётся (звонок важнее журнала)
  const poisk = (z) => shag(z, "select")?.[0] === "id,obrabotano,vzyato";
  const supabase2 = podmenaSupabase((z) => (poisk(z) ? { data: null, error: oshibka } : pamyat.otvet(z)));
  const prilozhenie2 = await sobratPrilozhenie(t, { supabase: supabase2 });
  const povtor = await sobytieMango(prilozhenie2.app, { zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(1) } });
  assert.deepEqual(povtor.json(), { status: "handled" });
  assert.equal(prilozhenie2.obrabotchik.vyzovy.length, 1);
  assert.match(prilozhenie2.zhurnalLog.zapisi.find((z) => z.uroven === "error").tekst, /обрабатываем дальше/);
});

test("г4) обрыв соединения: прокси закрыл его по таймауту, пока обработчик работал, — итог всё равно записан (onSend, не onResponse)", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: async (req, reply) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return reply.send({ status: "handled" });
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const forma = new URLSearchParams({
    vpbx_api_key: SEKRET_KLYUCH,
    sign: SEKRET_PODPIS,
    json: JSON.stringify(SOBYTIE_CALL),
  }).toString();

  await new Promise((resolve) => {
    const zapros = http.request({
      host: "127.0.0.1",
      port: app.server.address().port,
      method: "POST",
      path: "/events/call",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(forma),
        "x-proxy-secret": SEKRET,
      },
    });
    zapros.on("error", () => {});
    zapros.end(forma);
    setTimeout(() => {
      zapros.destroy();
      resolve();
    }, 40);
  });

  for (let popytka = 0; popytka < 60 && pamyat.stroki[0]?.kod !== 200; popytka += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(obrabotchik.vyzovy.length, 1, "обработчик дошёл до конца, хотя клиента уже нет");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200], "итог записан без onResponse");
});

test("д) границы позднего повтора: ровно 10 мин, свежий, без времени, мусорное время, не повтор — обработчик зовётся", async (t) => {
  const proby = {
    "ровно 10 минут": { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(10) },
    "9 минут": { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(9) },
    "повтор без x-mango-prinyato": { "x-mango-povtor": "1" },
    "мусорное x-mango-prinyato": { "x-mango-povtor": "1", "x-mango-prinyato": "вчера" },
    "старое время, но не повтор": { "x-mango-prinyato": minutNazad(120) },
    "x-mango-povtor: 0 и старое время": { "x-mango-povtor": "0", "x-mango-prinyato": minutNazad(120) },
  };
  for (const [nazvanie, zagolovki] of Object.entries(proby)) {
    const { app, obrabotchik } = await sobratPrilozhenie(t);
    const otvet = await sobytieMango(app, { zagolovki });
    assert.equal(otvet.statusCode, 200, nazvanie);
    assert.deepEqual(otvet.json(), { status: "handled" }, nazvanie);
    assert.equal(obrabotchik.vyzovy.length, 1, nazvanie);
  }
});

test("е) summary обрабатывается всегда: и свежий, и поздний повтор; не обработан только дубль", async (t) => {
  const { app, supabase, obrabotchik } = await sobratPrilozhenie(t);
  const svezhiy = await sobytieMango(app, { put: "/events/summary", obj: SOBYTIE_SUMMARY });
  const pozdniy = await sobytieMango(app, {
    put: "/events/summary",
    obj: SOBYTIE_SUMMARY,
    zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(600) },
  });
  assert.deepEqual([svezhiy.statusCode, pozdniy.statusCode], [200, 200]);
  assert.deepEqual([svezhiy.json(), pozdniy.json()], [{ status: "handled" }, { status: "handled" }]);
  assert.equal(obrabotchik.vyzovy.length, 2);
  const [stroka] = shag(supabase.zaprosy[0], "upsert");
  assert.equal(stroka.vid, "summary");
  assert.equal(stroka.klyuch, klyuchSobytiya("/events/summary", JSON.stringify(SOBYTIE_SUMMARY)));
});

test("ж) поздний повтор call, а запись не вышла: обработчик не зовётся, 503 — прокси оставит событие в очереди", async (t) => {
  const supabase = podmenaSupabase(() => ({ data: null, error: { message: "down", code: "08006" } }));
  const { app, obrabotchik, zhurnalLog } = await sobratPrilozhenie(t, { supabase });
  const otvet = await sobytieMango(app, {
    zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(30) },
  });

  assert.equal(otvet.statusCode, 503);
  assert.deepEqual(otvet.json(), { ok: false, error: "db_error" });
  assert.equal(obrabotchik.vyzovy.length, 0);
  assert.equal(zhurnalLog.zapisi.filter((z) => z.uroven === "error").length, 1);
  utverditChistyyZhurnal(zhurnalLog);
});

test("з) замок раньше журнала: без секрета при «требовать» — 403 на всех маршрутах, база и обработчик не тронуты", async (t) => {
  const marshruty = [
    ["POST", "/events/call"],
    ["POST", "/events/summary"],
    ["POST", "/internal/mango-event"],
    ["POST", "/internal/recording-id"],
    ["POST", "/internal/recording-attempt"],
    ["GET", "/internal/recording-queue"],
  ];
  const { app, supabase, obrabotchik } = await sobratPrilozhenie(t);

  for (const [metod, url] of marshruty) {
    const razy = [
      { nazvanie: "без секрета", zagolovki: {} },
      // подделанный XFF при «требовать» не спасает
      { nazvanie: "без секрета, XFF как у Selectel", zagolovki: { "x-forwarded-for": SELECTEL_IP } },
      { nazvanie: "чужой секрет", zagolovki: { "x-proxy-secret": NEVERNYY } },
    ];
    for (const { nazvanie, zagolovki } of razy) {
      const otvet = await app.inject({
        method: metod,
        url,
        headers: { "content-type": "application/json", ...zagolovki },
        ...(metod === "POST" ? { payload: JSON.stringify({ path: "/events/recording", body: {} }) } : {}),
      });
      assert.equal(otvet.statusCode, 403, `${metod} ${url} ${nazvanie}`);
      assert.deepEqual(otvet.json(), { error: "Forbidden" });
    }
  }
  assert.equal(supabase.zaprosy.length, 0, "база не должна вызываться до замка");
  assert.equal(obrabotchik.vyzovy.length, 0);

  // с верным секретом те же маршруты замок проходят (дальше — свои 200/400)
  for (const [metod, url] of marshruty) {
    const otvet = await vnutrennee(app, metod, url, metod === "POST" ? "{}" : undefined, {
      zagolovki: metod === "POST" ? { "content-type": "application/json" } : {},
    });
    assert.notEqual(otvet.statusCode, 403, `${metod} ${url} с верным секретом`);
  }
});

test("и) server.js: замок на onRequest, тело не больше 1 МБ, журнал в preHandler, итог в onSend; /internal/* только по секрету; npm test берёт тесты Mango", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /registerMarshrutyProksi\(fastify, zamokSekretProksi\)/);
  assert.match(server, /zamokSekretProksi = zamokProksi\.sozdatZamok\(\{[^}]*tolkoSekret: true/);
  for (const put of ["/events/call", "/events/summary"]) {
    const stroka = server.split("\n").find((s) => s.includes("fastify.post") && s.includes(`"${put}"`));
    assert.ok(stroka, `в server.js нет маршрута ${put}`);
    assert.ok(stroka.includes("handleMangoWebhook"), put);
    assert.ok(stroka.includes("onRequest: checkSelectelIP"), `${put}: замок должен быть на onRequest, до чтения тела`);
    assert.ok(!stroka.includes("preHandler: [") && !/preHandler:\s*checkSelectelIP/.test(stroka), `${put}: замок не должен стоять в preHandler`);
    assert.ok(stroka.includes("preHandler: zhurnalSobytiy.preHandler"), `${put}: журнал — preHandler`);
    assert.ok(stroka.includes("onSend: zhurnalSobytiy.onSend"), `${put}: итог ответа пишет onSend (onResponse при обрыве соединения не зовётся)`);
    assert.match(stroka, /bodyLimit: 1024 \* 1024/, `${put}: тело не больше 1 МБ`);
  }
  assert.ok(server.includes("секрет прокси или адрес Selectel"), "комментарий к маршрутам Mango");
  const skript = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).scripts.test;
  assert.ok(skript.includes("mango.calls.new/*.test.js"), "npm test не берёт тесты Mango");
  assert.ok(skript.includes("rutina/**/*.test.js"), "из npm test пропали тесты RUTINA");
  assert.ok(skript.includes("--max-old-space-size=1024") && skript.includes("--test-concurrency=2"), "потолок памяти и воркеров");
});

test("к) /internal/mango-event: зеркало записи в журнал, заголовки прокси попадают в строку, ответ {ok, duplicate}", async (t) => {
  const supabase = podmenaSupabase(() => ({ data: [{ id: 10 }], error: null }));
  const { app } = await sobratPrilozhenie(t, { supabase });
  const objZapisi = { entry_id: "ENTRY-9", call_id: "CALL-9", recording_id: "REC-9", recording_state: "Completed" };
  const formaMango = { vpbx_api_key: SEKRET_KLYUCH, sign: SEKRET_PODPIS, json: JSON.stringify(objZapisi) };

  const otvet = await vnutrenneePost(app, "/internal/mango-event", JSON.stringify({ path: "/events/recording", body: formaMango }), {
    zagolovki: { "x-mango-prinyato": minutNazad(3), "x-mango-podpis": "bad", "x-mango-povtor": "1" },
  });
  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { ok: true, duplicate: false });
  const [stroka] = shag(supabase.zaprosy[0], "upsert");
  assert.equal(stroka.vid, "recording");
  assert.equal(stroka.entry_id, "ENTRY-9");
  assert.equal(stroka.sobytie, null);
  assert.equal(stroka.podpis, "bad");
  assert.equal(stroka.povtor, true);
  assert.equal(stroka.prinyato, minutNazad(3));
  assert.equal(stroka.obrabotano, true, "обработчика у зеркала нет — только запись");
  assert.equal(stroka.kod, 200);
  assert.deepEqual(stroka.payload, objZapisi);
  assert.equal(stroka.klyuch, klyuchSobytiya("/events/recording", JSON.stringify(objZapisi)));

  const dobavlena = await vnutrenneePost(app, "/internal/mango-event", JSON.stringify({ path: "/events/record/added", body: formaMango }));
  assert.equal(dobavlena.statusCode, 200);
  assert.equal(shag(supabase.zaprosy[1], "upsert")[0].vid, "record_added");
});

test("л) /internal/mango-event: ключ уже есть — duplicate:true; чужой путь и кривое тело — 400 без записи; сбой базы — 500", async (t) => {
  const forma = { vpbx_api_key: SEKRET_KLYUCH, sign: SEKRET_PODPIS, json: JSON.stringify({ entry_id: "E" }) };
  const pamyat = pamyatMangoEvents();
  const prilozhenieDubl = await sobratPrilozhenie(t, { supabase: podmenaSupabase(pamyat.otvet) });
  const zerkalo = () =>
    vnutrenneePost(prilozhenieDubl.app, "/internal/mango-event", JSON.stringify({ path: "/events/recording", body: forma }));
  const pervoe = await zerkalo();
  const otvetDubl = await zerkalo();
  assert.deepEqual([pervoe.statusCode, pervoe.json()], [200, { ok: true, duplicate: false }]);
  assert.deepEqual([otvetDubl.statusCode, otvetDubl.json()], [200, { ok: true, duplicate: true }]);
  assert.equal(pamyat.stroki.length, 1);
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);

  const { app, supabase } = await sobratPrilozhenie(t);
  const plokhie = [
    { path: "/events/call", body: forma },
    { path: "/events/summary", body: forma },
    { path: "/etc/passwd", body: forma },
    { path: "/events/recording" },
    { path: "/events/recording", body: "строка" },
    { path: "/events/recording", body: [forma] },
    { path: "/events/recording", body: null },
    { body: forma },
    [],
  ];
  for (const telo of plokhie) {
    const otvet = await vnutrenneePost(app, "/internal/mango-event", JSON.stringify(telo));
    assert.equal(otvet.statusCode, 400, JSON.stringify(telo));
    assert.deepEqual(otvet.json(), { ok: false, error: "bad_request" });
  }
  assert.equal((await vnutrenneePost(app, "/internal/mango-event")).statusCode, 400);
  assert.equal(supabase.zaprosy.length, 0, "кривые запросы в базу не идут");

  const sbOsh = podmenaSupabase(() => ({ data: null, error: { message: "down", code: "08006", details: TELEFON } }));
  const prilozhenieOsh = await sobratPrilozhenie(t, { supabase: sbOsh });
  const otvetOsh = await vnutrenneePost(
    prilozhenieOsh.app,
    "/internal/mango-event",
    JSON.stringify({ path: "/events/recording", body: forma }),
  );
  assert.equal(otvetOsh.statusCode, 500, "не записали — не 2xx, иначе прокси сотрёт файл очереди");
  assert.deepEqual(otvetOsh.json(), { ok: false, error: "db_error" });
  utverditChistyyZhurnal(prilozhenieOsh.zhurnalLog);
});

test("м) маршруты прокси принимают тело не больше 1 МБ (разбор идёт до замка)", async (t) => {
  const { app, supabase } = await sobratPrilozhenie(t);
  const bolshoe = JSON.stringify({ path: "/events/recording", body: { json: "x".repeat(1024 * 1024 + 16) } });
  const otvet = await vnutrenneePost(app, "/internal/mango-event", bolshoe);
  assert.equal(otvet.statusCode, 413);
  assert.equal(supabase.zaprosy.length, 0);
});

// ---------------------------------------------------------------------------------------------
// POST /internal/recording-id, POST /internal/recording-attempt, GET /internal/recording-queue
// ---------------------------------------------------------------------------------------------

test("н) /internal/recording-id: пустая строка звонка — один PATCH recording_id=is.null (простые фильтры, без or=), тело {recording_id}", async (t) => {
  const ENTRY = "MToxMDA+/=&x y";
  const { klient, zaprosy } = klientSPodmenoyiSeti(() => ({ body: [{ id: 7 }] }));
  const { app } = await sobratPrilozhenie(t, { supabase: klient });

  const otvet = await vnutrenneePost(app, "/internal/recording-id", JSON.stringify({ entry_id: ENTRY, recording_id: "MToxMDIwNjUzMjoyODEyNDIxMTY4OTow" }));
  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { ok: true, inserted: false });
  assert.equal(zaprosy.length, 1, "одного запроса достаточно");
  const [z] = zaprosy;
  assert.equal(z.metod, "PATCH");
  utverditBezOr(zaprosy);
  // у прокси к PATCH только entry_id; наши — ещё «номер пуст» (recording_id=is.null) и select=id (как в db.js)
  utverditTotZhe(z.url, proksi.patch(ENTRY), { bez: ["select", "recording_id"] });
  assert.deepEqual([...z.url.searchParams], [["entry_id", `eq.${ENTRY}`], ["recording_id", "is.null"], ["select", "id"]]);
  assert.deepEqual(z.telo, { recording_id: "MToxMDIwNjUzMjoyODEyNDIxMTY4OTow" });
  assert.equal(z.zagolovki.get("prefer"), "return=representation");
  assert.equal(z.zagolovki.get("authorization"), "Bearer TEST-SERVICE-ROLE-KEY", "ключ у клиента сервера");
});

test("н2) /internal/recording-id: update ничего не взял — читаем recording_id строки: тот же номер → same:true, другой непустой → 409, записать нечего; без or=", async (t) => {
  const ENTRY = "ENTRY-ZANYATA";
  const sStrokoy = (nomer) => klientSPodmenoyiSeti((z) => (z.metod === "PATCH" ? { body: [] } : { body: [{ recording_id: nomer }] }));

  const odinakovyy = sStrokoy("REC-1");
  const prilozhenieSame = await sobratPrilozhenie(t, { supabase: odinakovyy.klient });
  const same = await vnutrenneePost(prilozhenieSame.app, "/internal/recording-id", JSON.stringify({ entry_id: ENTRY, recording_id: "REC-1" }));
  assert.deepEqual([same.statusCode, same.json()], [200, { ok: true, same: true }]);
  assert.deepEqual(odinakovyy.zaprosy.map((z) => z.metod), ["PATCH", "GET"], "ни заготовки, ни повторной записи");
  utverditBezOr(odinakovyy.zaprosy);
  // чтение: select=recording_id & entry_id=eq.X & limit=1
  assert.deepEqual([...odinakovyy.zaprosy[1].url.searchParams], [["select", "recording_id"], ["entry_id", `eq.${ENTRY}`], ["limit", "1"]]);

  const drugoy = sStrokoy("REC-STARYY");
  const prilozhenieDrugoy = await sobratPrilozhenie(t, { supabase: drugoy.klient });
  const konflikt = await vnutrenneePost(prilozhenieDrugoy.app, "/internal/recording-id", JSON.stringify({ entry_id: ENTRY, recording_id: "REC-NOVYY" }));
  assert.deepEqual([konflikt.statusCode, konflikt.json()], [409, { ok: false, error: "recording_id_conflict" }]);
  assert.deepEqual(drugoy.zaprosy.map((z) => z.metod), ["PATCH", "GET"], "чужой номер не затираем и заготовку не заводим");
  utverditBezOr(drugoy.zaprosy);
  assert.equal(prilozhenieDrugoy.zhurnalLog.zapisi.length, 0, "409 — не поломка, в лог не пишем");
});

test("н3) /internal/recording-id: гонка — между update и чтением строку заполнили или создали; один повтор, дальше ошибка", async (t) => {
  // строку создали между чтением и вставкой: заготовка упёрлась в уникальный entry_id → второй заход, update её берёт
  let vstavok = 0;
  const sGonkoy = klientSPodmenoyiSeti((z) => {
    if (z.metod === "POST") {
      vstavok += 1;
      return { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "mango_calls_entry_id_unique"' } };
    }
    if (z.metod === "PATCH") return { body: vstavok === 0 ? [] : [{ id: 5 }] };
    return { body: [] }; // чтение: строки ещё нет
  });
  const prilozhenie = await sobratPrilozhenie(t, { supabase: sGonkoy.klient });
  const otvet = await vnutrenneePost(prilozhenie.app, "/internal/recording-id", JSON.stringify({ entry_id: "E", recording_id: "R" }));
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { ok: true, inserted: false }]);
  assert.deepEqual(sGonkoy.zaprosy.map((z) => z.metod), ["PATCH", "GET", "POST", "PATCH"]);
  utverditBezOr(sGonkoy.zaprosy);
});

test("о) /internal/recording-id: строки нет — PATCH, чтение, затем та же заготовка, что у прокси (POST); ответ 200 inserted:true, не 404; без or=", async (t) => {
  const ENTRY = "ENTRY-NOVAYA";
  const { klient, zaprosy } = klientSPodmenoyiSeti((z) => (z.metod === "POST" ? { status: 201 } : { body: [] }));
  const { app } = await sobratPrilozhenie(t, { supabase: klient });

  const otvet = await vnutrenneePost(app, "/internal/recording-id", JSON.stringify({ entry_id: ENTRY, recording_id: "REC-2" }));
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { ok: true, inserted: true }]);
  assert.deepEqual(zaprosy.map((z) => z.metod), ["PATCH", "GET", "POST"]);
  utverditBezOr(zaprosy);
  utverditTotZhe(zaprosy[0].url, proksi.patch(ENTRY), { bez: ["select", "recording_id"] });
  utverditTotZhe(zaprosy[2].url, proksi.vstavka());
  assert.deepEqual(zaprosy[2].telo, {
    entry_id: ENTRY,
    client_phone: "",
    client_phone_digits: "",
    recording_id: "REC-2",
  });
});

test("п) /internal/recording-id: нет entry_id, пустой или кривой recording_id — 400 без запросов; сбой базы — 500 и чистый лог; конфликт уникальности — 409", async (t) => {
  const { klient, zaprosy } = klientSPodmenoyiSeti(() => ({ body: [{ id: 1 }] }));
  const { app } = await sobratPrilozhenie(t, { supabase: klient });
  const plokhie = [
    {},
    { recording_id: "R" },
    { entry_id: "" },
    { entry_id: { a: 1 } },
    { entry_id: "E" },
    { entry_id: "E", recording_id: null },
    { entry_id: "E", recording_id: "" },
    { entry_id: "E", recording_id: { a: 1 } },
    { entry_id: "E", recording_id: [1] },
  ];
  for (const telo of plokhie) {
    const otvet = await vnutrenneePost(app, "/internal/recording-id", JSON.stringify(telo));
    assert.equal(otvet.statusCode, 400, JSON.stringify(telo));
  }
  assert.equal((await vnutrenneePost(app, "/internal/recording-id")).statusCode, 400);
  assert.equal(zaprosy.length, 0);

  const { klient: sbOsh } = klientSPodmenoyiSeti(() => ({
    status: 403,
    body: { message: "permission denied", code: "42501", details: TELEFON, hint: null },
  }));
  const prilozhenieOsh = await sobratPrilozhenie(t, { supabase: sbOsh });
  const otvet = await vnutrenneePost(prilozhenieOsh.app, "/internal/recording-id", JSON.stringify({ entry_id: "E", recording_id: "R" }));
  assert.deepEqual([otvet.statusCode, otvet.json()], [500, { ok: false, error: "db_error" }]);
  assert.match(prilozhenieOsh.zhurnalLog.zapisi[0].tekst, /42501: permission denied/);
  utverditChistyyZhurnal(prilozhenieOsh.zhurnalLog);

  // номер записи уже занят другим звонком (уникальный recording_id) → 409: прокси положит в otkazano и повторять не будет
  const zanyat = klientSPodmenoyiSeti(() => ({
    status: 409,
    body: { code: "23505", message: 'duplicate key value violates unique constraint "mango_calls_recording_id_unique"' },
  }));
  const prilozhenieZanyat = await sobratPrilozhenie(t, { supabase: zanyat.klient });
  const otvetZanyat = await vnutrenneePost(prilozhenieZanyat.app, "/internal/recording-id", JSON.stringify({ entry_id: "E", recording_id: "R" }));
  assert.deepEqual([otvetZanyat.statusCode, otvetZanyat.json()], [409, { ok: false, error: "recording_id_conflict" }]);

  // заготовка упёрлась в занятый другим звонком recording_id (уникальный recording_id) → тоже 409
  const zanyatVstavka = klientSPodmenoyiSeti((z) =>
    z.metod === "POST"
      ? { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "mango_calls_recording_id_unique"' } }
      : { body: [] },
  );
  const prilozhenieVstavka = await sobratPrilozhenie(t, { supabase: zanyatVstavka.klient });
  const otvetVstavka = await vnutrenneePost(prilozhenieVstavka.app, "/internal/recording-id", JSON.stringify({ entry_id: "E", recording_id: "R" }));
  assert.deepEqual([otvetVstavka.statusCode, otvetVstavka.json()], [409, { ok: false, error: "recording_id_conflict" }]);
  assert.deepEqual(zanyatVstavka.zaprosy.map((z) => z.metod), ["PATCH", "GET", "POST"]);
  assert.equal(prilozhenieZanyat.zhurnalLog.zapisi.length + prilozhenieVstavka.zhurnalLog.zapisi.length, 0, "409 — не поломка, в лог не пишем");
});

test("р) /internal/recording-queue: тот же запрос, что у воркера прокси (поля, фильтры, порядок, лимит 5), ответ — массив", async (t) => {
  const stroki = [
    { entry_id: "E1", recording_id: "R1", recording_status: "pending", updated_at: "2026-10-17T11:00:00+00:00" },
    { entry_id: "E2", recording_id: "R2", recording_status: "failed", updated_at: "2026-10-17T11:05:00+00:00" },
  ];
  const { klient, zaprosy } = klientSPodmenoyiSeti(() => ({ body: stroki }));
  const { app } = await sobratPrilozhenie(t, { supabase: klient });

  const otvet = await vnutrennee(app, "GET", "/internal/recording-queue?limit=5");
  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), stroki);
  assert.equal(zaprosy.length, 1);
  assert.equal(zaprosy[0].metod, "GET");
  utverditTotZhe(zaprosy[0].url, proksi.ochered(NOW, 5));
  utverditBezOr(zaprosy);

  // без limit — пачка прокси (5); мусор — тоже 5; потолок 50; нормальное число — как есть
  const limity = [[undefined, 5], ["abc", 5], ["0", 5], ["-3", 5], ["3", 3], ["999", 50]];
  for (const [znachenie, ozhidaemyy] of limity) {
    zaprosy.length = 0;
    const url = znachenie === undefined ? "/internal/recording-queue" : `/internal/recording-queue?limit=${znachenie}`;
    assert.equal((await vnutrennee(app, "GET", url)).statusCode, 200);
    utverditTotZhe(zaprosy[0].url, proksi.ochered(NOW, ozhidaemyy));
  }
});

test("с) /internal/recording-queue: пусто — [], сбой базы — 500 (не пустой список, чтобы прокси видел поломку)", async (t) => {
  const pusto = klientSPodmenoyiSeti(() => ({ body: [] }));
  const prilozhenie = await sobratPrilozhenie(t, { supabase: pusto.klient });
  const otvet = await vnutrennee(prilozhenie.app, "GET", "/internal/recording-queue");
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, []]);

  const sbityy = klientSPodmenoyiSeti(() => ({ status: 500, body: { message: "boom", code: "XX000" } }));
  const prilozhenieSboy = await sobratPrilozhenie(t, { supabase: sbityy.klient });
  const sboy = await vnutrennee(prilozhenieSboy.app, "GET", "/internal/recording-queue");
  assert.deepEqual([sboy.statusCode, sboy.json()], [500, { ok: false, error: "db_error" }]);
});

test("т) /internal/recording-attempt: pending и failed — одним PATCH с условием (нет файла и не ready), без отдельного select", async (t) => {
  const ENTRY = "E+1=";
  for (const status of ["pending", "failed"]) {
    const { klient, zaprosy } = klientSPodmenoyiSeti(() => ({ body: [{ id: 3 }] }));
    const { app } = await sobratPrilozhenie(t, { supabase: klient });

    const otvet = await vnutrenneePost(app, "/internal/recording-attempt", JSON.stringify({ entry_id: ENTRY, recording_status: status }));
    utverditBezOr(zaprosy);
    assert.deepEqual([otvet.statusCode, otvet.json()], [200, { ok: true, updated: true, inserted: false, skipped: false }], status);
    assert.equal(zaprosy.length, 1, "один запрос: ни GET, ни второго PATCH");
    const [z] = zaprosy;
    assert.equal(z.metod, "PATCH");
    utverditTotZhe(z.url, proksi.patch(ENTRY), { bez: ["select", "storage_path", "recording_status"] });
    assert.equal(z.url.searchParams.get("storage_path"), "is.null");
    assert.equal(z.url.searchParams.get("recording_status"), "neq.ready");
    assert.equal(z.url.searchParams.get("select"), "id");
    assert.deepEqual(z.telo, { recording_status: status });
  }
});

test("у) /internal/recording-attempt: файл уже есть (storage_path) или статус ready — строку не трогаем (skipped), строки нет — заготовка", async (t) => {
  // update ничего не подошёл, заготовка упёрлась в уникальный entry_id: значит строка есть, но под защитой
  const zashchishchena = klientSPodmenoyiSeti((z) =>
    z.metod === "PATCH"
      ? { body: [] }
      : { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "mango_calls_entry_id_unique"' } },
  );
  const prilozhenieZashchita = await sobratPrilozhenie(t, { supabase: zashchishchena.klient });
  for (const status of ["pending", "failed"]) {
    const otvet = await vnutrenneePost(prilozhenieZashchita.app, "/internal/recording-attempt", JSON.stringify({ entry_id: "E", recording_status: status }));
    assert.deepEqual([otvet.statusCode, otvet.json()], [200, { ok: true, updated: false, inserted: false, skipped: true }], status);
  }
  assert.equal(prilozhenieZashchita.zhurnalLog.zapisi.length, 0);

  // строки нет совсем: заготовка, как у прокси
  const net = klientSPodmenoyiSeti((z) => (z.metod === "POST" ? { status: 201 } : { body: [] }));
  const prilozhenieNet = await sobratPrilozhenie(t, { supabase: net.klient });
  const otvet = await vnutrenneePost(prilozhenieNet.app, "/internal/recording-attempt", JSON.stringify({ entry_id: "E", recording_status: "failed" }));
  assert.deepEqual([otvet.statusCode, otvet.json()], [200, { ok: true, updated: false, inserted: true, skipped: false }]);
  assert.deepEqual(net.zaprosy.map((z) => z.metod), ["PATCH", "POST"]);
  utverditBezOr([...net.zaprosy, ...zashchishchena.zaprosy]);
  assert.deepEqual(net.zaprosy[1].telo, { entry_id: "E", client_phone: "", client_phone_digits: "", recording_status: "failed" });
});

test("ф) /internal/recording-attempt: чужой или пустой статус — 400 без запросов; сбой базы — 500", async (t) => {
  const { klient, zaprosy } = klientSPodmenoyiSeti(() => ({ body: [{ id: 1 }] }));
  const { app } = await sobratPrilozhenie(t, { supabase: klient });
  for (const telo of [{ entry_id: "E" }, { entry_id: "E", recording_status: "ready" }, { entry_id: "E", recording_status: "downloading" }, { recording_status: "failed" }]) {
    const plokhoy = await vnutrenneePost(app, "/internal/recording-attempt", JSON.stringify(telo));
    assert.equal(plokhoy.statusCode, 400, JSON.stringify(telo));
  }
  assert.equal(zaprosy.length, 0);

  const sboy = klientSPodmenoyiSeti(() => ({ status: 500, body: { message: "boom", code: "XX000" } }));
  const prilozhenieSboy = await sobratPrilozhenie(t, { supabase: sboy.klient });
  const otvet = await vnutrenneePost(prilozhenieSboy.app, "/internal/recording-attempt", JSON.stringify({ entry_id: "E", recording_status: "pending" }));
  assert.deepEqual([otvet.statusCode, otvet.json()], [500, { ok: false, error: "db_error" }]);
  assert.deepEqual(sboy.zaprosy.map((z) => z.metod), ["PATCH"]);
});

test("ц) подключение при старте: чистка запускается сама, если её не отключили, и таймер не держит процесс", async (t) => {
  const intervaly = [];
  t.mock.method(globalThis, "setInterval", (fn, ms) => {
    const taimer = { fn, ms, unrefVyzvan: false, unref: () => ((taimer.unrefVyzvan = true), taimer) };
    intervaly.push(taimer);
    return taimer;
  });
  const supabase = podmenaSupabase(() => ({ data: null, error: null, count: 0 }));
  const app = Fastify();
  t.after(() => app.close());
  const zhurnal = registerMarshrutyProksi(app, async () => {}, { supabase, log: podmenaLog().log, now: () => NOW });
  assert.deepEqual(Object.keys(zhurnal).sort(), ["onSend", "preHandler"]);
  assert.equal(typeof zhurnal.preHandler, "function");
  assert.equal(typeof zhurnal.onSend, "function");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supabase.zaprosy.length, 1, "при старте — проход чистки");
  assert.equal(supabase.zaprosy[0].tablitsa, "mango_events");
  assert.equal(intervaly.length, 1);
  assert.equal(intervaly[0].ms, 24 * 60 * 60 * 1000);
  assert.equal(intervaly[0].unrefVyzvan, true);
});

// ---------------------------------------------------------------------------------------------
// Проверка 3·4: замок до чтения тела, аренда, законченный звонок, строгое время, ключ service_role
// ---------------------------------------------------------------------------------------------

test("п1) /events/*: замок на onRequest — большое тело без секрета получает 403 до чтения (не 413), с секретом — 413; нормальное проходит", async (t) => {
  const { app, supabase, obrabotchik, chtenie } = await sobratPrilozhenie(t);
  const bolshoe = new URLSearchParams({ json: "x".repeat(1024 * 1024 + 100) }).toString();
  const zapros = (put, zagolovki) =>
    app.inject({
      method: "POST",
      url: put,
      headers: { "content-type": "application/x-www-form-urlencoded", ...zagolovki },
      payload: bolshoe,
    });

  for (const put of ["/events/call", "/events/summary"]) {
    for (const zagolovki of [{}, { "x-forwarded-for": SELECTEL_IP }, { "x-proxy-secret": NEVERNYY }]) {
      const otvet = await zapros(put, zagolovki);
      assert.equal(otvet.statusCode, 403, `${put} ${JSON.stringify(Object.keys(zagolovki))}`);
      assert.deepEqual(otvet.json(), { error: "Forbidden" });
    }
  }
  assert.equal(chtenie.zaprosov, 0, "тело читалось, хотя замок не пустил");

  for (const put of ["/events/call", "/events/summary"]) {
    const otvet = await zapros(put, { "x-proxy-secret": SEKRET });
    assert.equal(otvet.statusCode, 413, `${put}: с секретом тело больше 1 МБ не принимаем`);
  }
  assert.equal(supabase.zaprosy.length, 0);
  assert.equal(obrabotchik.vyzovy.length, 0);

  const normalnoe = await sobytieMango(app);
  assert.deepEqual(normalnoe.json(), { status: "handled" });
  assert.equal(chtenie.zaprosov, 3, "два 413 и один нормальный дошли до чтения");
});

test("п1б) большое событие (≈150 КБ json): обработчику уходит всё, в журнале payload обрезан до начала, ключ и entry_id — от полного", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik } = await sobratPrilozhenie(t, { supabase: podmenaSupabase(pamyat.otvet) });
  const bolshoe = { ...SOBYTIE_CALL, zametka: "я".repeat(75000) };
  const strokaJson = JSON.stringify(bolshoe);

  const otvet = await sobytieMango(app, { obj: bolshoe });
  assert.equal(otvet.statusCode, 200);
  assert.equal(obrabotchik.vyzovy[0].body.json, strokaJson, "обработчик получил json целиком");
  const [stroka] = pamyat.stroki;
  assert.equal(stroka.klyuch, klyuchSobytiya("/events/call", strokaJson));
  assert.equal(stroka.entry_id, "ENTRY-1");
  assert.equal(stroka.sobytie, "Appeared@abonent");
  assert.deepEqual(Object.keys(stroka.payload).sort(), ["_nachalo", "_obrezano", "_razmer"]);
  assert.equal(stroka.payload._obrezano, true);
  assert.equal(stroka.payload._razmer, Buffer.byteLength(strokaJson, "utf8"));
  assert.ok(Buffer.byteLength(stroka.payload._nachalo, "utf8") <= 4096 + 3);
  assert.ok(strokaJson.startsWith(stroka.payload._nachalo.slice(0, 100)), "_nachalo — начало json");
});

test("п3) аренда: дубль необработанного в работе (vzyato моложе 60 с) → 503 zanyato без обработчика и без записи итога; старше 60 с — берём заново", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: (req, reply, nomer) => reply.code(nomer === 1 ? 500 : 200).send({ nomer }),
  });
  const povtor = () => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() });

  assert.equal((await sobytieMango(app)).statusCode, 500);
  await peredacha();
  const arendaPervogo = pamyat.stroki[0].vzyato;
  assert.equal(arendaPervogo, new Date(NOW).toISOString(), "новая строка сразу в аренде");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [false, 500]);

  chasy.teper += 59 * 1000;
  const zanyato = await sobytieMango(app, { zagolovki: povtor() });
  await peredacha();
  assert.deepEqual([zanyato.statusCode, zanyato.json()], [503, { ok: false, error: "zanyato" }]);
  assert.equal(obrabotchik.vyzovy.length, 1, "обработчик не зовётся, пока событие в работе");
  assert.deepEqual([pamyat.stroki[0].kod, pamyat.stroki[0].vzyato], [500, arendaPervogo], "ответ 503 «занято» ничего не пишет в чужую строку");

  chasy.teper += 2 * 1000; // итого 61 с
  const vzyali = await sobytieMango(app, { zagolovki: povtor() });
  await peredacha();
  assert.deepEqual(vzyali.json(), { nomer: 2 });
  assert.equal(obrabotchik.vyzovy.length, 2);
  assert.equal(pamyat.stroki[0].vzyato, new Date(chasy.teper).toISOString(), "аренда продлена на новый заход");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);
});

test("п3б) итог не затирает обработанное: старая копия ответила 5xx уже после того, как другая дала 200, — строка остаётся true/200", async (t) => {
  const pamyat = pamyatMangoEvents();
  let otpustitPervyy;
  const zhdetPervyy = new Promise((resolve) => (otpustitPervyy = resolve));
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: async (req, reply, nomer) => {
      if (nomer === 1) {
        await zhdetPervyy;
        return reply.code(500).send({ nomer });
      }
      return reply.code(200).send({ nomer });
    },
  });

  const pervyy = sobytieMango(app); // зависает в обработчике
  for (let i = 0; i < 100 && obrabotchik.vyzovy.length < 1; i += 1) await peredacha();
  assert.equal(obrabotchik.vyzovy.length, 1);

  chasy.teper += ARENDA_MS + 1000; // аренда первого истекла, второй заход берёт событие
  const vtoroy = await sobytieMango(app, { zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() } });
  await peredacha();
  assert.equal(vtoroy.statusCode, 200);
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);

  otpustitPervyy();
  assert.equal((await pervyy).statusCode, 500);
  await peredacha();
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200], "запоздалое 500 не должно затереть true");
});

test("п3в) гонка: два повтора прочли одно и то же состояние после истечения аренды — обработчик зовётся один раз, второй получает 503 (условный update)", async (t) => {
  const pamyat = pamyatMangoEvents();
  // оба повтора читают строку до того, как кто-либо перехватил аренду: ответ на чтение удерживаем, пока не придут оба
  const poiskStaroy = [];
  const supabase = podmenaSupabase((z) => {
    if (shag(z, "select")?.[0] !== "id,obrabotano,vzyato") return pamyat.otvet(z);
    const snimok = pamyat.otvet(z);
    return new Promise((resolve) => {
      poiskStaroy.push(() => resolve(snimok));
      if (poiskStaroy.length === 2) poiskStaroy.forEach((otpustit) => otpustit());
    });
  });
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase,
    otvetObrabotchika: (req, reply, nomer) => reply.code(nomer === 1 ? 500 : 200).send({ nomer }),
  });
  assert.equal((await sobytieMango(app)).statusCode, 500);
  await peredacha();

  chasy.teper += ARENDA_MS + 1000;
  const povtor = { "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() };
  const otvety = await Promise.all([sobytieMango(app, { zagolovki: povtor }), sobytieMango(app, { zagolovki: povtor })]);
  await peredacha();
  assert.deepEqual(otvety.map((o) => o.statusCode).sort(), [200, 503]);
  assert.deepEqual(otvety.find((o) => o.statusCode === 503).json(), { ok: false, error: "zanyato" });
  assert.equal(obrabotchik.vyzovy.length, 2, "первый заход + один из двух повторов");
  assert.deepEqual([pamyat.stroki[0].obrabotano, pamyat.stroki[0].kod], [true, 200]);
});

test("п4) новые /internal/*: секрет обязателен всегда — без него и с подделанным XFF 403, даже без «требовать» и без секрета в env; события Mango по адресу проходят", async (t) => {
  const marshruty = [
    ["POST", "/internal/mango-event"],
    ["POST", "/internal/recording-id"],
    ["POST", "/internal/recording-attempt"],
    ["GET", "/internal/recording-queue"],
  ];
  const sredy = {
    "в env ничего нет": {},
    "секрет есть, «требовать» нет": { MANGO_PROXY_SECRET: SEKRET },
  };
  for (const [nazvanie, env] of Object.entries(sredy)) {
    const { app, supabase, obrabotchik } = await sobratPrilozhenie(t, { env });
    for (const [metod, url] of marshruty) {
      for (const zagolovki of [{ "x-forwarded-for": SELECTEL_IP }, { "x-proxy-secret": NEVERNYY, "x-forwarded-for": SELECTEL_IP }]) {
        const otvet = await app.inject({
          method: metod,
          url,
          headers: { "content-type": "application/json", ...zagolovki },
          ...(metod === "POST" ? { payload: JSON.stringify({ entry_id: "E", recording_id: "R" }) } : {}),
        });
        assert.equal(otvet.statusCode, 403, `${nazvanie}: ${metod} ${url}`);
      }
    }
    assert.equal(supabase.zaprosy.length, 0, `${nazvanie}: база не тронута`);

    // старые маршруты Mango: адрес Selectel по-прежнему пускает (пока «требовать» не включено)
    const poAdresu = await sobytieMango(app, { sekret: null, zagolovki: { "x-forwarded-for": SELECTEL_IP } });
    assert.equal(poAdresu.statusCode, 200, `${nazvanie}: /events/call по адресу`);
    assert.equal(obrabotchik.vyzovy.length, 1);
  }

  // секрет задан и верный — новые маршруты открываются; секрета в env нет — не открываются даже «верным» заголовком
  const sSekretom = await sobratPrilozhenie(t, { env: { MANGO_PROXY_SECRET: SEKRET } });
  assert.notEqual((await vnutrennee(sSekretom.app, "GET", "/internal/recording-queue")).statusCode, 403);
  const bezSekreta = await sobratPrilozhenie(t, { env: {} });
  assert.equal((await vnutrennee(bezSekreta.app, "GET", "/internal/recording-queue", undefined, { sekret: SEKRET })).statusCode, 403);
});

test("п6) повтор call-события по законченному звонку (есть summary или Disconnected с тем же entry_id) — только запись, без обработчика", async (t) => {
  const pamyat = pamyatMangoEvents();
  const { app, obrabotchik, chasy } = await sobratPrilozhenie(t, {
    supabase: podmenaSupabase(pamyat.otvet),
    otvetObrabotchika: (req, reply, nomer) => reply.code(nomer === 3 ? 500 : 200).send({ nomer }),
  });
  const svezhiyPovtor = () => ({ "x-mango-povtor": "1", "x-mango-prinyato": new Date(chasy.teper - MINUT).toISOString() });
  const drugoyZvonok = (obj) => ({ ...obj, entry_id: "ENTRY-2", call_id: "CALL-2" });

  // звонок ENTRY-1 закончился: пришёл Disconnected
  await sobytieMango(app, { obj: SOBYTIE_DISCONNECTED });
  await peredacha();
  assert.equal(obrabotchik.vyzovy.length, 1);

  // повтор Connected того же звонка: звонок закончен → только запись
  const connected = await sobytieMango(app, { obj: SOBYTIE_CONNECTED, zagolovki: svezhiyPovtor() });
  await peredacha();
  assert.deepEqual(connected.json(), { ok: true, stale: true });
  assert.equal(obrabotchik.vyzovy.length, 1);
  assert.deepEqual([pamyat.stroki[1].obrabotano, pamyat.stroki[1].kod], [true, 200]);

  // тот же повтор без x-mango-povtor (первая доставка, а не досылка) — обрабатывается как обычно
  const pervayaDostavka = await sobytieMango(app, { obj: { ...SOBYTIE_CONNECTED, seq: 5 } });
  assert.deepEqual(pervayaDostavka.json(), { nomer: 2 });

  // чужой звонок: Disconnected у ENTRY-1 не мешает повтору Connected у ENTRY-2
  const chuzhoy = await sobytieMango(app, { obj: drugoyZvonok(SOBYTIE_CONNECTED), zagolovki: svezhiyPovtor() });
  assert.deepEqual(chuzhoy.json(), { nomer: 3 }.nomer === 3 ? { nomer: 3 } : {});

  // summary закончил звонок так же, как Disconnected
  await sobytieMango(app, { put: "/events/summary", obj: { ...SOBYTIE_SUMMARY, entry_id: "ENTRY-3", call_id: "CALL-3" } });
  const posleSummary = await sobytieMango(app, { obj: { ...SOBYTIE_CONNECTED, entry_id: "ENTRY-3", call_id: "CALL-3" }, zagolovki: svezhiyPovtor() });
  assert.deepEqual(posleSummary.json(), { ok: true, stale: true });

  // повтор самого Disconnected: «других» событий о конце звонка нет, его надо обработать (когда аренда истекла)
  chasy.teper += ARENDA_MS + 1000;
  const sam = await sobytieMango(app, { obj: SOBYTIE_DISCONNECTED, zagolovki: svezhiyPovtor() });
  assert.deepEqual(sam.json(), { ok: true, duplicate: true }, "он уже был обработан (200) — это дубль, а не «законченный звонок»");
});

test("п6б) повтор call: ошибка чтения журнала при проверке «звонок закончен» — 503, ничего не записано и не арендовано", async (t) => {
  const pamyat = pamyatMangoEvents();
  const proverka = (z) => shag(z, "select")?.[0] === "klyuch,vid,sobytie";
  const supabase = podmenaSupabase((z) => (proverka(z) ? { data: null, error: { message: "down", code: "08006" } } : pamyat.otvet(z)));
  const { app, obrabotchik, zhurnalLog } = await sobratPrilozhenie(t, { supabase });
  const otvet = await sobytieMango(app, { zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": minutNazad(1) } });
  assert.deepEqual([otvet.statusCode, otvet.json()], [503, { ok: false, error: "db_error" }]);
  assert.equal(obrabotchik.vyzovy.length, 0);
  assert.equal(pamyat.stroki.length, 0);
  assert.match(zhurnalLog.zapisi[0].tekst, /не проверили, закончен ли звонок \(08006: down\)/);
  utverditChistyyZhurnal(zhurnalLog);
});

test("п7) x-mango-prinyato принимается только как ISO с Z или ±hh:mm; иное считается «нет заголовка» — повтор не поздний", async (t) => {
  const pozdnoe = async (prinyato) => {
    const { app, obrabotchik } = await sobratPrilozhenie(t);
    const otvet = await sobytieMango(app, { obj: SOBYTIE_CONNECTED, zagolovki: { "x-mango-povtor": "1", "x-mango-prinyato": prinyato } });
    return otvet.json().stale === true && obrabotchik.vyzovy.length === 0;
  };
  // 11 минут назад в разной записи, но допустимой
  assert.equal(await pozdnoe("2026-10-17T11:49:00Z"), true);
  assert.equal(await pozdnoe("2026-10-17T11:49:00.250Z"), true);
  assert.equal(await pozdnoe("2026-10-17T14:49:00+03:00"), true);
  assert.equal(await pozdnoe("2026-10-17T06:49:00-05:00"), true);
  // недопустимые записи того же момента: считаем, что заголовка нет, значит повтор не поздний
  for (const plokhoe of ["2026-10-17T11:49:00", "2026-10-17 11:49:00Z", "Sat, 17 Oct 2026 11:49:00 GMT", "17.10.2026 11:49", "1760698140", "2026-10-17T11:49Z", "2026-13-45T11:49:00Z", ""]) {
    assert.equal(await pozdnoe(plokhoe), false, `«${plokhoe}»`);
  }
});

test("п7б) ключ service_role: при старте одна строка «журнал Mango: ключ service_role есть/нет» (без значения); для чужого клиента строки нет", async (t) => {
  for (const [est, slovo] of [[true, "есть"], [false, "нет"]]) {
    const app = Fastify();
    t.after(() => app.close());
    const zhurnal = podmenaLog();
    registerMarshrutyProksi(app, async () => {}, {
      supabase: podmenaSupabase(),
      log: zhurnal.log,
      now: () => NOW,
      chistka: false,
      servisnyyKlyuch: est,
    });
    assert.deepEqual(zhurnal.zapisi, [{ uroven: "log", tekst: `журнал Mango: ключ service_role ${slovo}` }]);
  }
  const app = Fastify();
  t.after(() => app.close());
  const molchit = podmenaLog();
  registerMarshrutyProksi(app, async () => {}, { supabase: podmenaSupabase(), log: molchit.log, now: () => NOW, chistka: false });
  assert.deepEqual(molchit.zapisi, []);
});

test("ч) в коде маршрутов прокси и журнала нет .or(: or-фильтр на update в бою не прошёл (42703)", () => {
  for (const imya of ["marshrutyProksi.js", "zhurnalSobytiy.js"]) {
    const kod = fs.readFileSync(path.join(__dirname, imya), "utf8").split("\n").filter((stroka) => !stroka.trim().startsWith("//")).join("\n");
    assert.ok(!/\.or\(/.test(kod), `${imya}: появился .or(`);
  }
});
