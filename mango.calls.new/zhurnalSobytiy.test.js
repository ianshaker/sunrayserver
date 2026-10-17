"use strict";

// Журнал сырых событий Mango (mango_events): разбор тела, ключ, вставка, чистка. Сети и базы нет:
// клиент Supabase подменён. Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test mango.calls.new/zhurnalSobytiy.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHISTKA_PERIOD_MS,
  ARENDA_MS,
  ZAPIS_TAIMAUT_MS,
  klyuchSobytiya,
  razobratTelo,
  vremyaPrinyatiya,
  sobratZapis,
  vstavitSobytie,
  zvonokZavershen,
  otmetitItog,
  zapisatSobytie,
  ochistitStarye,
  zapustitChistku,
} = require("./zhurnalSobytiy");
const { podmenaSupabase, shag, podmenaLog, peredacha, pamyatMangoEvents } = require("./podmenaSupabase");

const SEKRET_KLYUCH = "VPBX-KLYUCH-SEKRET-111";
const SEKRET_PODPIS = "PODPIS-SEKRET-222";
const TELEFON = "79990001122";

// Тело Mango, как его разбирает formbody: поля формы, json — строка.
function teloMango(obj, { klyuch = SEKRET_KLYUCH, podpis = SEKRET_PODPIS } = {}) {
  return { vpbx_api_key: klyuch, sign: podpis, json: JSON.stringify(obj) };
}

const SOBYTIE_CALL = {
  entry_id: "ENTRY-1",
  call_id: "CALL-1",
  seq: 3,
  call_state: "Appeared",
  location: "abonent",
  from: { number: TELEFON },
  to: { extension: "101" },
};

test("а) ключ: sha256(path + перевод строки + json как пришёл), стабилен и зависит от каждой части", () => {
  const json = '{"a":1}';
  // эталон посчитан отдельно: printf '/events/call\n{"a":1}' | shasum -a 256
  assert.equal(
    klyuchSobytiya("/events/call", json),
    "60183f162ba3683b85709bf55146795833861ca14b5b0b4b158f74112ee0842b",
  );
  assert.equal(
    klyuchSobytiya("/events/summary", json),
    "d32c93ecb5db0771c114a1dd6205fb1a8b2f0a35f6fa0b472fada4649ad57040",
  );
  assert.equal(klyuchSobytiya("/events/call", json), klyuchSobytiya("/events/call", json));
  // строка «как пришла»: лишний пробел — другое событие, ничего не нормализуем
  assert.equal(
    klyuchSobytiya("/events/call", '{"a": 1}'),
    "6cb511f8718bca882f88ac7e2596179224427ce881d4cc0534a4ff0a4b1c602e",
  );
  assert.match(klyuchSobytiya("/events/call", json), /^[0-9a-f]{64}$/);
});

test("б) ключ берётся из поля json: ключ и подпись формы на него не влияют", () => {
  const a = sobratZapis({ path: "/events/call", telo: teloMango(SOBYTIE_CALL, { podpis: "podpis-A" }) });
  const b = sobratZapis({ path: "/events/call", telo: teloMango(SOBYTIE_CALL, { podpis: "podpis-B", klyuch: "drugoy" }) });
  assert.equal(a.klyuch, b.klyuch);
  assert.equal(a.klyuch, klyuchSobytiya("/events/call", JSON.stringify(SOBYTIE_CALL)));
  // тот же json на другом пути — другое событие
  const c = sobratZapis({ path: "/events/summary", telo: teloMango(SOBYTIE_CALL) });
  assert.notEqual(a.klyuch, c.klyuch);
});

test("в) строка таблицы по call-событию: vid, sobytie, entry_id, call_id, payload", () => {
  const zapis = sobratZapis({
    path: "/events/call",
    telo: teloMango(SOBYTIE_CALL),
    prinyato: "2026-10-17T09:00:00Z",
    podpis: "ok",
    povtor: true,
  });
  assert.equal(zapis.path, "/events/call");
  assert.equal(zapis.vid, "call");
  assert.equal(zapis.sobytie, "Appeared@abonent");
  assert.equal(zapis.entry_id, "ENTRY-1");
  assert.equal(zapis.call_id, "CALL-1");
  assert.deepEqual(zapis.payload, SOBYTIE_CALL);
  assert.equal(zapis.prinyato, "2026-10-17T09:00:00.000Z");
  assert.equal(zapis.podpis, "ok");
  assert.equal(zapis.povtor, true);
  // колонки zapisano и id ставит база
  assert.deepEqual(
    Object.keys(zapis).sort(),
    ["call_id", "entry_id", "klyuch", "path", "payload", "podpis", "povtor", "prinyato", "sobytie", "vid"].sort(),
  );
});

test("г) sobytie: без location — просто call_state; нет call_state — null; у не-call всегда null", () => {
  const bezMesta = sobratZapis({ path: "/events/call", telo: teloMango({ call_state: "Connected", entry_id: "E" }) });
  assert.equal(bezMesta.sobytie, "Connected");
  const bezSostoyaniya = sobratZapis({ path: "/events/call", telo: teloMango({ entry_id: "E", location: "ivr" }) });
  assert.equal(bezSostoyaniya.sobytie, null);
  const itog = sobratZapis({
    path: "/events/summary",
    telo: teloMango({ entry_id: "E", call_direction: 1, call_state: "Disconnected", location: "abonent" }),
  });
  assert.equal(itog.vid, "summary");
  assert.equal(itog.sobytie, null);
});

test("д) vid по пути: summary, recording, record_added; чужой путь — null", () => {
  const vid = (path) => sobratZapis({ path, telo: teloMango({ entry_id: "E" }) }).vid;
  assert.equal(vid("/events/summary"), "summary");
  assert.equal(vid("/events/recording"), "recording");
  assert.equal(vid("/events/record/added"), "record_added");
  assert.equal(vid("/events/drugoe"), null);
});

test("е) payload без vpbx_api_key и sign: ни из формы, ни изнутри json, ни в одном поле строки", () => {
  const vnutri = { ...SOBYTIE_CALL, vpbx_api_key: "KLYUCH-VNUTRI-333", sign: "PODPIS-VNUTRI-444" };
  const zapis = sobratZapis({ path: "/events/call", telo: teloMango(vnutri), podpis: "ok" });
  assert.deepEqual(zapis.payload, SOBYTIE_CALL);
  assert.ok(!("vpbx_api_key" in zapis.payload));
  assert.ok(!("sign" in zapis.payload));
  const tekst = JSON.stringify(zapis);
  for (const sekret of [SEKRET_KLYUCH, SEKRET_PODPIS, "KLYUCH-VNUTRI-333", "PODPIS-VNUTRI-444"]) {
    assert.ok(!tekst.includes(sekret), `в строке журнала есть ${sekret}`);
  }
});

test("ж) неразборный json — { _syroe: строка }: не JSON, не объект, пустая строка", () => {
  const proby = ["{не json", "[1,2,3]", "123", "null", '"abc"', ""];
  for (const stroka of proby) {
    const zapis = sobratZapis({ path: "/events/call", telo: { vpbx_api_key: SEKRET_KLYUCH, sign: SEKRET_PODPIS, json: stroka } });
    assert.deepEqual(zapis.payload, { _syroe: stroka }, `json=${JSON.stringify(stroka)}`);
    assert.equal(zapis.entry_id, null);
    assert.equal(zapis.call_id, null);
    assert.equal(zapis.sobytie, null);
    assert.equal(zapis.klyuch, klyuchSobytiya("/events/call", stroka));
    assert.ok(!JSON.stringify(zapis).includes(SEKRET_KLYUCH));
  }
});

test("з) тело без поля json (плоское, как принимает handleMangoWebhook): строка = тело без ключа и подписи", () => {
  const ploskoe = { vpbx_api_key: SEKRET_KLYUCH, sign: SEKRET_PODPIS, entry_id: "FLAT-1", call_state: "Connected" };
  const zapis = sobratZapis({ path: "/events/call", telo: ploskoe });
  assert.deepEqual(zapis.payload, { entry_id: "FLAT-1", call_state: "Connected" });
  assert.equal(zapis.entry_id, "FLAT-1");
  assert.equal(zapis.sobytie, "Connected");
  const drugoe = sobratZapis({ path: "/events/call", telo: { ...ploskoe, entry_id: "FLAT-2" } });
  assert.notEqual(zapis.klyuch, drugoe.klyuch, "разные плоские события не должны сливаться в один ключ");
  // пустое и неподходящее тело не бросает
  for (const telo of [undefined, null, "строка", 42, [], {}]) {
    const zapisPustaya = sobratZapis({ path: "/events/call", telo });
    assert.deepEqual(zapisPustaya.payload, {});
    assert.match(zapisPustaya.klyuch, /^[0-9a-f]{64}$/);
  }
});

test("и) тело с null-прототипом (так отдаёт querystring) и числовые id", () => {
  const telo = Object.assign(Object.create(null), teloMango({ entry_id: 12345, call_id: 678, call_state: "Appeared" }));
  const zapis = sobratZapis({ path: "/events/call", telo });
  assert.equal(zapis.entry_id, "12345");
  assert.equal(zapis.call_id, "678");
  assert.deepEqual(razobratTelo(telo).payload, { entry_id: 12345, call_id: 678, call_state: "Appeared" });
});

test("к) заголовки: prinyato → ISO, мусор → null; podpis обрезается; povtor — булево", () => {
  const zapis = (zagolovki) => sobratZapis({ path: "/events/call", telo: teloMango(SOBYTIE_CALL), ...zagolovki });
  assert.equal(zapis({ prinyato: "2026-10-17T12:34:56.789Z" }).prinyato, "2026-10-17T12:34:56.789Z");
  assert.equal(zapis({ prinyato: "не время" }).prinyato, null);
  assert.equal(zapis({ prinyato: "" }).prinyato, null);
  assert.equal(zapis({ prinyato: undefined }).prinyato, null);
  assert.equal(zapis({ podpis: "  bad " }).podpis, "bad");
  assert.equal(zapis({ podpis: "x".repeat(100) }).podpis.length, 32);
  assert.equal(zapis({ podpis: "" }).podpis, null);
  assert.equal(zapis({}).podpis, null);
  assert.equal(zapis({}).povtor, false);
  assert.equal(zapis({ povtor: true }).povtor, true);
});

test("л) вставка: INSERT ... ON CONFLICT (klyuch) DO NOTHING в mango_events, ответ { novoe, oshibka }", async () => {
  const sb = podmenaSupabase(() => ({ data: [{ id: 5 }], error: null }));
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const itog = await zapisatSobytie(sb, { path: "/events/call", telo: teloMango(SOBYTIE_CALL) }, { teper: () => T });
  assert.deepEqual(itog, { novoe: true, oshibka: null, id: 5, obrabotano: false, zanyato: false });
  assert.equal(sb.zaprosy.length, 1);
  const [zapros] = sb.zaprosy;
  assert.equal(zapros.tablitsa, "mango_events");
  const [stroka, parametry] = shag(zapros, "upsert");
  assert.deepEqual(parametry, { onConflict: "klyuch", ignoreDuplicates: true });
  assert.equal(stroka.klyuch, klyuchSobytiya("/events/call", JSON.stringify(SOBYTIE_CALL)));
  assert.equal(stroka.vzyato, "2026-10-17T12:00:00.000Z", "новая строка сразу в аренде");
  assert.deepEqual(shag(zapros, "select"), ["id"]);
});

test("м) ключ уже есть (пустой список): obrabotano=true — дубль; false и аренда моложе 60 с — «занято»; старше — перехват одним условным update", async () => {
  const vhod = { path: "/events/call", telo: teloMango(SOBYTIE_CALL) };
  const klyuch = klyuchSobytiya("/events/call", JSON.stringify(SOBYTIE_CALL));
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const vzyatoSekundNazad = (sek) => new Date(T - sek * 1000).toISOString();
  const staraya = (obrabotano, vzyato) => podmenaSupabase((z) => {
    if (shag(z, "upsert")) return { data: [], error: null };
    if (shag(z, "update")) return { data: [{ id: 9 }], error: null };
    return { data: [{ id: 9, obrabotano, vzyato }], error: null };
  });

  // обработано — дубль, в аренду не лезем
  const sbDubl = staraya(true, vzyatoSekundNazad(5));
  assert.deepEqual(await zapisatSobytie(sbDubl, vhod, { teper: () => T }), { novoe: false, oshibka: null, id: 9, obrabotano: true, zanyato: false });
  assert.equal(sbDubl.zaprosy.length, 2, "вставка и один поиск старой строки");
  assert.equal(sbDubl.zaprosy[1].tablitsa, "mango_events");
  assert.deepEqual(shag(sbDubl.zaprosy[1], "select"), ["id,obrabotano,vzyato"]);
  assert.deepEqual(shag(sbDubl.zaprosy[1], "eq"), ["klyuch", klyuch]);
  assert.deepEqual(shag(sbDubl.zaprosy[1], "limit"), [1]);

  // в работе (моложе 60 с): занято, перехвата нет
  for (const sek of [0, 30, 59]) {
    const sb = staraya(false, vzyatoSekundNazad(sek));
    assert.deepEqual(await zapisatSobytie(sb, vhod, { teper: () => T }), { novoe: false, oshibka: null, id: 9, obrabotano: false, zanyato: true }, `${sek} с`);
    assert.equal(sb.zaprosy.length, 2, "перехвата нет");
  }

  // аренда истекла (60 с и старше): перехват одним update «где id, не обработано и vzyato прежнее»
  for (const sek of [60, 61, 3600]) {
    const staroeVzyato = vzyatoSekundNazad(sek);
    const sb = staraya(false, staroeVzyato);
    assert.deepEqual(await zapisatSobytie(sb, vhod, { teper: () => T }), { novoe: false, oshibka: null, id: 9, obrabotano: false, zanyato: false }, `${sek} с`);
    assert.equal(sb.zaprosy.length, 3);
    const perekhvat = sb.zaprosy[2];
    assert.deepEqual(shag(perekhvat, "update"), [{ vzyato: new Date(T).toISOString() }]);
    assert.deepEqual(perekhvat.shagi.filter(([imya]) => imya === "eq").map(([, a, b]) => [a, b]), [["id", 9], ["obrabotano", false], ["vzyato", staroeVzyato]]);
    assert.deepEqual(shag(perekhvat, "select"), ["id"]);
  }

  // аренды не было вовсе (строка без vzyato): условие is null
  const sbBez = staraya(false, null);
  assert.equal((await zapisatSobytie(sbBez, vhod, { teper: () => T })).zanyato, false);
  assert.deepEqual(shag(sbBez.zaprosy[2], "is"), ["vzyato", null]);

  // перехват не удался (кто-то успел раньше: update ничего не изменил) — занято
  const sbGonka = podmenaSupabase((z) => {
    if (shag(z, "upsert")) return { data: [], error: null };
    if (shag(z, "update")) return { data: [], error: null };
    return { data: [{ id: 9, obrabotano: false, vzyato: vzyatoSekundNazad(120) }], error: null };
  });
  assert.equal((await zapisatSobytie(sbGonka, vhod, { teper: () => T })).zanyato, true);
});

test("м2) дубль, а старую строку найти не вышло (ошибка, пустой ответ, молчание базы) — ошибка записи, не «дубль»", async () => {
  const vhod = { path: "/events/call", telo: teloMango(SOBYTIE_CALL) };
  const poisk = (otvetPoiska) => podmenaSupabase((z) => (shag(z, "upsert") ? { data: [], error: null } : otvetPoiska()));

  const sOshibkoy = await zapisatSobytie(poisk(() => ({ data: null, error: { message: "boom", code: "XX000" } })), vhod);
  assert.deepEqual(sOshibkoy, { novoe: null, oshibka: { message: "boom", code: "XX000" } });

  const pusto = await zapisatSobytie(poisk(() => ({ data: [], error: null })), vhod);
  assert.equal(pusto.novoe, null);
  assert.match(pusto.oshibka.message, /ключ есть, а строки нет/);

  const molchit = await vstavitSobytie(poisk(() => new Promise(() => {})), sobratZapis(vhod), { taimautMs: 20 });
  assert.equal(molchit.novoe, null);
  assert.match(molchit.oshibka.message, /не ответила/);

  // старая строка найдена, аренда истекла, а сам перехват упал — тоже ошибка записи
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const sbPerekhvat = podmenaSupabase((z) => {
    if (shag(z, "upsert")) return { data: [], error: null };
    if (shag(z, "update")) return { data: null, error: { message: "down", code: "08006" } };
    return { data: [{ id: 9, obrabotano: false, vzyato: new Date(T - 120000).toISOString() }], error: null };
  });
  assert.deepEqual(await zapisatSobytie(sbPerekhvat, vhod, { teper: () => T }), { novoe: null, oshibka: { message: "down", code: "08006" } });
});

test("м3) память вместо таблицы: тот же ключ дважды — вторая вставка видит старую строку: в работе, потом (после аренды) берёт, потом (обработано) дубль", async () => {
  const pamyat = pamyatMangoEvents();
  const sb = podmenaSupabase(pamyat.otvet);
  const vhod = { path: "/events/call", telo: teloMango(SOBYTIE_CALL) };
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const na = (sek) => ({ teper: () => T + sek * 1000 });

  const pervaya = await zapisatSobytie(sb, vhod, na(0));
  assert.deepEqual(pervaya, { novoe: true, oshibka: null, id: 1, obrabotano: false, zanyato: false });
  const vRabote = await zapisatSobytie(sb, vhod, na(10));
  assert.deepEqual(vRabote, { novoe: false, oshibka: null, id: 1, obrabotano: false, zanyato: true });
  const posleArendy = await zapisatSobytie(sb, vhod, na(ARENDA_MS / 1000 + 1));
  assert.deepEqual(posleArendy, { novoe: false, oshibka: null, id: 1, obrabotano: false, zanyato: false });
  assert.equal(pamyat.stroki[0].vzyato, new Date(T + (ARENDA_MS + 1000)).toISOString(), "аренда обновлена");

  pamyat.stroki[0].obrabotano = true;
  const tretya = await zapisatSobytie(sb, vhod, na(500));
  assert.deepEqual(tretya, { novoe: false, oshibka: null, id: 1, obrabotano: true, zanyato: false });
  assert.equal(pamyat.stroki.length, 1, "строка одна");

  // строка, записанная сразу как «обработано» (зеркало записей, поздний повтор), аренды не получает
  const zerkalo = await vstavitSobytie(sb, { ...sobratZapis({ path: "/events/recording", telo: teloMango({ entry_id: "R" }) }), obrabotano: true, kod: 200 });
  assert.deepEqual(zerkalo, { novoe: true, oshibka: null, id: 2, obrabotano: true, zanyato: false });
  assert.equal(pamyat.stroki[1].kod, 200);
  assert.equal(pamyat.stroki[1].vzyato, null);
});

test("м4) итог ответа: update obrabotano = (код < 500), kod = код — по id строки", async () => {
  const proby = [[200, true], [204, true], [400, true], [404, true], [499, true], [500, false], [502, false], [503, false]];
  for (const [kod, obrabotano] of proby) {
    const sb = podmenaSupabase(() => ({ data: null, error: null }));
    assert.deepEqual(await otmetitItog(sb, 41, kod), { oshibka: null }, `код ${kod}`);
    assert.equal(sb.zaprosy.length, 1);
    assert.equal(sb.zaprosy[0].tablitsa, "mango_events");
    assert.deepEqual(shag(sb.zaprosy[0], "update"), [{ obrabotano, kod }], `код ${kod}`);
    // только пока строка не обработана: уже записанное true не затираем
    assert.deepEqual(sb.zaprosy[0].shagi.filter(([imya]) => imya === "eq").map(([, a, b]) => [a, b]), [["id", 41], ["obrabotano", false]]);
  }
});

test("м5) итог ответа: ошибка базы, отказ, сбой клиента и молчание базы возвращаются, а не бросаются", async () => {
  const oshibka = { message: "denied", code: "42501" };
  assert.deepEqual(await otmetitItog(podmenaSupabase(() => ({ data: null, error: oshibka })), 1, 200), { oshibka });
  const otkaz = new Error("fetch failed");
  assert.deepEqual(await otmetitItog(podmenaSupabase(() => Promise.reject(otkaz)), 1, 200), { oshibka: otkaz });
  const sbolnoy = { from() { throw new Error("клиент сломан"); } };
  assert.equal((await otmetitItog(sbolnoy, 1, 200)).oshibka.message, "клиент сломан");
  const molchit = await otmetitItog(podmenaSupabase(() => new Promise(() => {})), 1, 200, { taimautMs: 20 });
  assert.match(molchit.oshibka.message, /не ответила/);
});

test("н) ошибка базы не бросается, а возвращается: ответ с error, отказ запроса, сбой клиента, молчание базы", async () => {
  const vhod = { path: "/events/call", telo: teloMango(SOBYTIE_CALL) };
  const oshibkaBazy = { message: "relation does not exist", code: "42P01" };

  const sOtvetom = await zapisatSobytie(podmenaSupabase(() => ({ data: null, error: oshibkaBazy })), vhod);
  assert.deepEqual(sOtvetom, { novoe: null, oshibka: oshibkaBazy });

  const otkaz = new Error("fetch failed");
  const sOtkazom = await zapisatSobytie(
    podmenaSupabase(() => Promise.reject(otkaz)),
    vhod,
  );
  assert.deepEqual(sOtkazom, { novoe: null, oshibka: otkaz });

  const sbolnoy = {
    from() {
      throw new Error("клиент сломан");
    },
  };
  const sBroskom = await zapisatSobytie(sbolnoy, vhod);
  assert.equal(sBroskom.novoe, null);
  assert.equal(sBroskom.oshibka.message, "клиент сломан");

  // ответ не списком — не дубль, а ошибка: событие надо обработать, а не потерять
  const strannyy = await zapisatSobytie(podmenaSupabase(() => ({ data: null, error: null })), vhod);
  assert.equal(strannyy.novoe, null);
  assert.ok(strannyy.oshibka);

  // база молчит — ошибка по таймауту, звонок не ждёт
  const molchit = await vstavitSobytie(
    podmenaSupabase(() => new Promise(() => {})),
    sobratZapis(vhod),
    { taimautMs: 20 },
  );
  assert.equal(molchit.novoe, null);
  assert.match(molchit.oshibka.message, /не ответила/);
});

test("о) чистка: delete по zapisano старше 90 дней, число удалённых из count", async () => {
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const sb = podmenaSupabase(() => ({ data: null, error: null, count: 7 }));
  const itog = await ochistitStarye(sb, { now: () => T });
  assert.deepEqual(itog, { udaleno: 7, oshibka: null });
  const [zapros] = sb.zaprosy;
  assert.equal(zapros.tablitsa, "mango_events");
  assert.deepEqual(shag(zapros, "delete"), [{ count: "exact" }]);
  assert.deepEqual(shag(zapros, "lt"), ["zapisano", new Date(T - 90 * 24 * 60 * 60 * 1000).toISOString()]);
  assert.equal(shag(zapros, "lt")[1], "2026-07-19T12:00:00.000Z");

  const oshibka = { message: "denied", code: "42501" };
  const sbOsh = podmenaSupabase(() => ({ data: null, error: oshibka }));
  assert.deepEqual(await ochistitStarye(sbOsh, { now: () => T }), { udaleno: null, oshibka });
  const sbBros = podmenaSupabase(() => Promise.reject(new Error("сеть")));
  assert.equal((await ochistitStarye(sbBros, { now: () => T })).oshibka.message, "сеть");
});

// Подмена setInterval: запоминает период и обратный вызов и считает вызовы unref.
function podmenitInterval(t) {
  const intervaly = [];
  t.mock.method(globalThis, "setInterval", (fn, ms) => {
    const taimer = {
      fn,
      ms,
      unrefVyzvan: false,
      unref() {
        taimer.unrefVyzvan = true;
        return taimer;
      },
    };
    intervaly.push(taimer);
    return taimer;
  });
  return intervaly;
}

test("п) чистка запускается при старте и раз в сутки, таймер не держит процесс (unref)", async (t) => {
  const intervaly = podmenitInterval(t);
  const T = Date.parse("2026-10-17T12:00:00.000Z");
  const sb = podmenaSupabase(() => ({ data: null, error: null, count: 0 }));
  const { log, zapisi } = podmenaLog();

  const taimer = zapustitChistku({ supabase: sb, log, now: () => T });
  await peredacha();
  assert.equal(sb.zaprosy.length, 1, "при старте — один проход");
  assert.equal(intervaly.length, 1);
  assert.equal(intervaly[0].ms, 24 * 60 * 60 * 1000, "период — сутки");
  assert.equal(CHISTKA_PERIOD_MS, 24 * 60 * 60 * 1000);
  assert.equal(taimer, intervaly[0]);
  assert.equal(intervaly[0].unrefVyzvan, true, "таймер должен быть unref");

  await intervaly[0].fn();
  assert.equal(sb.zaprosy.length, 2, "по таймеру — следующий проход");
  await intervaly[0].fn();
  assert.equal(sb.zaprosy.length, 3);
  assert.equal(zapisi.filter((z) => z.uroven === "error").length, 0);
});

test("р) ошибка чистки уходит в лог без деталей строки и не роняет ни старт, ни сутки", async (t) => {
  const intervaly = podmenitInterval(t);
  const oshibka = { message: "permission denied", code: "42501", details: `Failing row contains (${TELEFON})` };
  const sb = podmenaSupabase(() => ({ data: null, error: oshibka }));
  const { log, zapisi } = podmenaLog();

  zapustitChistku({ supabase: sb, log });
  await peredacha();
  await intervaly[0].fn();

  const oshibki = zapisi.filter((z) => z.uroven === "error");
  assert.equal(oshibki.length, 2);
  assert.match(oshibki[0].tekst, /чистка не удалась: 42501: permission denied/);
  assert.ok(!JSON.stringify(zapisi).includes(TELEFON), "детали ошибки (строка таблицы) попали в лог");
});

test("с) payload больше 64 КБ обрезается: { _obrezano, _razmer, _nachalo (первые 4 КБ) }; ключ, entry_id, sobytie берутся из полного json", () => {
  const poRazmeru = (razmer) => {
    const pustoe = JSON.stringify({ ...SOBYTIE_CALL, z: "" });
    const obj = { ...SOBYTIE_CALL, z: "a".repeat(razmer - Buffer.byteLength(pustoe, "utf8")) };
    assert.equal(Buffer.byteLength(JSON.stringify(obj), "utf8"), razmer);
    return obj;
  };
  // ровно 64 КБ — храним целиком, на байт больше — обрезаем
  const rovno = sobratZapis({ path: "/events/call", telo: teloMango(poRazmeru(65536)) });
  assert.equal(rovno.payload._obrezano, undefined);
  assert.equal(rovno.payload.entry_id, "ENTRY-1");

  const bolshoe = poRazmeru(65537);
  const strokaJson = JSON.stringify(bolshoe);
  const zapis = sobratZapis({ path: "/events/call", telo: teloMango(bolshoe) });
  assert.deepEqual(Object.keys(zapis.payload).sort(), ["_nachalo", "_obrezano", "_razmer"]);
  assert.equal(zapis.payload._obrezano, true);
  assert.equal(zapis.payload._razmer, 65537);
  assert.equal(zapis.payload._nachalo, strokaJson.slice(0, 4096));
  assert.equal(zapis.klyuch, klyuchSobytiya("/events/call", strokaJson), "ключ — от полной строки");
  assert.equal(zapis.entry_id, "ENTRY-1");
  assert.equal(zapis.call_id, "CALL-1");
  assert.equal(zapis.sobytie, "Appeared@abonent");

  // многобайтные знаки: начало не длиннее 4 КБ в байтах и без разрезанных символов и NUL
  const russkoe = sobratZapis({ path: "/events/call", telo: teloMango({ ...SOBYTIE_CALL, z: "я\u0000".repeat(40000) }) });
  assert.equal(russkoe.payload._obrezano, true);
  assert.ok(Buffer.byteLength(russkoe.payload._nachalo, "utf8") <= 4096 + 2);
  assert.ok(!russkoe.payload._nachalo.includes("\u0000"));
  assert.ok(!russkoe.payload._nachalo.includes("\ufffd") || russkoe.payload._nachalo.endsWith("\ufffd"));

  // неразборный большой json: обрезается так же
  const syroe = sobratZapis({ path: "/events/call", telo: { json: "{" + "x".repeat(70000) } });
  assert.equal(syroe.payload._obrezano, true);
  assert.equal(syroe.payload._razmer, 70001);
});

test("т) таймаут записи журнала — 2 с; x-mango-prinyato — только ISO с Z или ±hh:mm", () => {
  assert.equal(ZAPIS_TAIMAUT_MS, 2000);
  const OK = ["2026-10-17T12:00:00Z", "2026-10-17T12:00:00.123Z", "2026-10-17T12:00:00.123456789Z", "2026-10-17T15:00:00+03:00", "2026-10-17T07:00:00-05:00", "  2026-10-17T12:00:00Z  "];
  for (const zagolovok of OK) assert.equal(vremyaPrinyatiya(zagolovok), Date.parse("2026-10-17T12:00:00Z") + (zagolovok.includes(".123") ? 123 : 0), zagolovok);
  const NE_OK = [undefined, null, 5, "", " ", "вчера", "2026-10-17", "2026-10-17T12:00:00", "2026-10-17 12:00:00Z", "2026-10-17T12:00Z", "2026-10-17T12:00:00+0300", "2026-10-17T12:00:00+03", "Sat, 17 Oct 2026 12:00:00 GMT", "1760702400", "2026-13-45T12:00:00Z", "2026-10-17T25:00:00Z"];
  for (const zagolovok of NE_OK) assert.equal(vremyaPrinyatiya(zagolovok), null, String(zagolovok));
  assert.equal(sobratZapis({ path: "/events/call", telo: teloMango(SOBYTIE_CALL), prinyato: "17.10.2026 12:00" }).prinyato, null);
});

test("у) звонок закончен по журналу: есть чужое summary или call с Disconnected по тому же entry_id; свою строку и чужой звонок не считаем", async () => {
  const stroki = [
    { klyuch: "svoy", vid: "call", sobytie: "Disconnected@abonent" },
    { klyuch: "a", vid: "call", sobytie: "Appeared@abonent" },
    { klyuch: "b", vid: "call", sobytie: "Connected" },
    { klyuch: "v", vid: "recording", sobytie: null },
  ];
  const sb = (spisok) => podmenaSupabase(() => ({ data: spisok, error: null }));
  assert.deepEqual(await zvonokZavershen(sb(stroki), "E", "svoy"), { zavershen: false, oshibka: null }, "своя строка не в счёт");
  assert.equal((await zvonokZavershen(sb([...stroki, { klyuch: "g", vid: "call", sobytie: "Disconnected@ivr" }]), "E", "svoy")).zavershen, true);
  assert.equal((await zvonokZavershen(sb([...stroki, { klyuch: "d", vid: "summary", sobytie: null }]), "E", "svoy")).zavershen, true);
  assert.equal((await zvonokZavershen(sb([]), "E", "svoy")).zavershen, false);

  const zapros = sb(stroki);
  await zvonokZavershen(zapros, "ENTRY-9", "svoy");
  assert.equal(zapros.zaprosy[0].tablitsa, "mango_events");
  assert.deepEqual(shag(zapros.zaprosy[0], "select"), ["klyuch,vid,sobytie"]);
  assert.deepEqual(shag(zapros.zaprosy[0], "eq"), ["entry_id", "ENTRY-9"]);

  const oshibka = { message: "down", code: "08006" };
  assert.deepEqual(await zvonokZavershen(podmenaSupabase(() => ({ data: null, error: oshibka })), "E", "svoy"), { zavershen: null, oshibka });
  assert.match((await zvonokZavershen(podmenaSupabase(() => new Promise(() => {})), "E", "svoy", { taimautMs: 20 })).oshibka.message, /не ответила/);
});
