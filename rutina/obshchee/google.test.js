"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MODEL, ZAPASNAYA_MODEL, adresModeli, chitatKlyuch, sozdatGoogle } = require("./google");
const { OshibkaRutiny } = require("./otvety");
const { zhurnalVPamyat } = require("../testy/pomoshchniki");

// Подмена клиента google-auth-library: request(opts) по сценарию.
function istochnik(otvetit) {
  const vyzovy = [];
  return {
    vyzovy,
    proekt: () => "proekt-testa",
    klient: async () => ({
      request: (opts) => {
        vyzovy.push(opts);
        return otvetit(opts, vyzovy.length);
      },
    }),
  };
}

// Ошибка, похожая на GaxiosError: тело запроса и заголовки с токеном внутри.
function oshibkaGaxios(status, telo) {
  const oshibka = new Error(`Request failed with status code ${status}`);
  oshibka.name = "GaxiosError";
  oshibka.code = String(status);
  oshibka.config = { data: telo, headers: { Authorization: "Bearer ya29.SEKRETNYY-TOKEN" } };
  oshibka.response = { status, config: oshibka.config, data: { error: { message: "oshibka" } } };
  return oshibka;
}

test("адрес модели — Vertex global, проект из ключа", () => {
  assert.equal(
    adresModeli("p1", MODEL),
    "https://aiplatform.googleapis.com/v1/projects/p1/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent",
  );
  assert.equal(MODEL, "gemini-3.5-flash-lite");
  assert.equal(ZAPASNAYA_MODEL, "gemini-3.1-flash-lite");
});

test("ключ: нет, не JSON, без проекта — своя ошибка без содержимого", () => {
  assert.throws(() => chitatKlyuch({}), (o) => o instanceof OshibkaRutiny && o.prichina === "net_klyucha");
  assert.throws(
    () => chitatKlyuch({ GOOGLE_APPLICATION_CREDENTIALS_JSON: "{private_key: SEKRET" }),
    (o) => o instanceof OshibkaRutiny && o.prichina === "klyuch_ne_json" && !o.message.includes("SEKRET"),
  );
  assert.throws(
    () => chitatKlyuch({ GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}" }),
    (o) => o.prichina === "klyuch_bez_proekta",
  );
  assert.equal(chitatKlyuch({ GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"project_id":"p"}' }).proekt, "p");
});

test("вызов: retry false, тайм-аут, POST, ответ — data и модель", async () => {
  const ist = istochnik(async () => ({ status: 200, data: { candidates: [] } }));
  const g = sozdatGoogle({ istochnik: ist, zhurnal: () => {} });
  const otvet = await g.sprositModel({ a: 1 });
  assert.deepEqual(otvet, { data: { candidates: [] }, model: MODEL });
  const [opts] = ist.vyzovy;
  assert.equal(opts.retry, false);
  assert.equal(opts.method, "POST");
  assert.ok(opts.timeout > 44_000 && opts.timeout <= 45_000);
  assert.ok(opts.signal);
  assert.ok(opts.url.includes("/locations/global/"));
});

test("404 у основной модели — запасная", async () => {
  const ist = istochnik(async (opts, n) => {
    if (n === 1) throw oshibkaGaxios(404, "AAAA");
    return { data: { ok: true } };
  });
  const g = sozdatGoogle({ istochnik: ist, zhurnal: () => {} });
  const otvet = await g.sprositModel({});
  assert.equal(otvet.model, ZAPASNAYA_MODEL);
  assert.ok(ist.vyzovy[1].url.includes(ZAPASNAYA_MODEL));
});

test("500 — golos_sboy без второй попытки", async () => {
  const ist = istochnik(async () => {
    throw oshibkaGaxios(500, "AAAA");
  });
  const g = sozdatGoogle({ istochnik: ist, zhurnal: () => {} });
  await assert.rejects(g.sprositModel({}), (o) => o.kod === "golos_sboy" && o.prichina === "status_500");
  assert.equal(ist.vyzovy.length, 1);
});

test("модель молчит дольше срока — golos_dolgo, запрос отменён", async () => {
  let otmenen = false;
  const ist = istochnik(
    (opts) =>
      new Promise((_, otkaz) => {
        opts.signal.addEventListener("abort", () => {
          otmenen = true;
          otkaz(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
  );
  const g = sozdatGoogle({ istochnik: ist, zhurnal: () => {}, taymautMs: 30 });
  await assert.rejects(g.sprositModel({}), (o) => o.kod === "golos_dolgo");
  assert.equal(otmenen, true);
});

test("тайм-аут сети от gaxios — тоже golos_dolgo", async () => {
  const ist = istochnik(async () => {
    throw Object.assign(new Error("network timeout at: https://…"), { type: "request-timeout" });
  });
  const g = sozdatGoogle({ istochnik: ist, zhurnal: () => {} });
  await assert.rejects(g.sprositModel({}), (o) => o.kod === "golos_dolgo");
});

test("ошибка модели — в журнале нет base64 аудио и токена", async () => {
  const audio = Buffer.from("golos-yana-".repeat(500));
  const base64 = audio.toString("base64");
  const telo = { contents: [{ parts: [{ inlineData: { mimeType: "audio/webm", data: base64 } }] }] };
  const ist = istochnik(async () => {
    throw oshibkaGaxios(400, telo);
  });
  const { stroki, zhurnal } = zhurnalVPamyat();
  const g = sozdatGoogle({ istochnik: ist, zhurnal });
  let poymana;
  await g.sprositModel(telo, { dlinaZaprosa: audio.length }).catch((o) => {
    poymana = o;
  });
  assert.ok(poymana instanceof OshibkaRutiny);
  assert.equal(poymana.config, undefined, "исходная ошибка не уходит дальше");
  const vse = stroki.join("\n") + JSON.stringify(poymana) + String(poymana.message);
  assert.ok(stroki.length >= 1);
  assert.ok(!vse.includes(base64.slice(0, 40)), "base64 в журнале");
  assert.ok(!vse.includes("ya29"), "токен в журнале");
  assert.match(stroki[0], /"status":400/);
  assert.match(stroki[0], new RegExp(`"dlinaZaprosa":${audio.length}`));
});

test("ключа нет — golos_sboy, клиента не зовём", async () => {
  const g = sozdatGoogle({
    istochnik: {
      proekt: () => chitatKlyuch({}).proekt,
      klient: async () => {
        throw new Error("ne dolzhen");
      },
    },
    zhurnal: () => {},
  });
  await assert.rejects(g.sprositModel({}), (o) => o.kod === "golos_sboy" && o.prichina === "net_klyucha");
});
