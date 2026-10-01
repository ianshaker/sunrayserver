"use strict";

// Адреса RUTINA на сервере «как Sunray»: тот же корень, что в server.js
// (bodyLimit 55 МБ, cors origin '*', formbody, корневой audio/mpeg), потом
// наша область. Без запуска server.js, без сети, Google — подменой.

const test = require("node:test");
const assert = require("node:assert/strict");
const { Writable } = require("stream");
const { sozdatVhod } = require("../obshchee/vhod");
const { sozdatGoogle } = require("../obshchee/google");
const { PREDEL_BAYT } = require("../diktovka/diktovka");
const {
  sozdatKlyuch,
  sdelatToken,
  sobratKakSunray,
  googleOtvechaet,
  zhurnalVPamyat,
} = require("./pomoshchniki");

const KLYUCH = sozdatKlyuch();

function vhodNaSvoyomKlyuche({ padaet = false } = {}) {
  return sozdatVhod({
    zhurnal: () => {},
    zagruzit: async () => {
      if (padaet) throw new Error("net seti");
      return { keys: [KLYUCH.jwk] };
    },
  });
}

function token() {
  return "Bearer " + sdelatToken(KLYUCH);
}

async function server(nastroyki = {}, logStream) {
  const { stroki, zhurnal } = zhurnalVPamyat();
  const app = sobratKakSunray({
    nastroyki: {
      vhod: vhodNaSvoyomKlyuche(),
      google: googleOtvechaet({ status: "ok", text: "Текст Яна." }),
      zhurnal,
      ...nastroyki,
    },
    logStream,
  });
  await app.ready();
  return { app, stroki };
}

function golos(app, { tip = "audio/webm;codecs=opus", telo = Buffer.from("zvuk-webm"), avtorizaciya = token() } = {}) {
  const headers = { "content-type": tip, origin: "https://rutina.ink" };
  if (avtorizaciya) headers.authorization = avtorizaciya;
  return app.inject({ method: "POST", url: "/rutina/diktovka", headers, payload: telo });
}

test("сборка поверх корневого audio/mpeg проходит ready()", async () => {
  const { app } = await server();
  await app.close();
});

test("проверка ловит Ы1: свой audio/mpeg в области уронил бы сервер", async () => {
  const fastify = require("fastify")();
  fastify.addContentTypeParser("audio/mpeg", { parseAs: "buffer" }, (_r, b, d) => d(null, b));
  fastify.register(async (oblast) => {
    oblast.addContentTypeParser("audio/mpeg", { parseAs: "buffer" }, (_r, b, d) => d(null, b));
  });
  await assert.rejects(fastify.ready(), (o) => o.code === "FST_ERR_CTP_ALREADY_PRESENT");
});

test("GET /rutina/zdorov — жива, без входа", async () => {
  const { app } = await server();
  const otvet = await app.inject({ method: "GET", url: "/rutina/zdorov" });
  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { status: "ok" });
  await app.close();
});

test("preflight OPTIONS с Authorization проходит CORS Sunray", async () => {
  const { app } = await server();
  const otvet = await app.inject({
    method: "OPTIONS",
    url: "/rutina/diktovka",
    headers: {
      origin: "https://rutina.ink",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(otvet.statusCode, 204);
  assert.equal(otvet.headers["access-control-allow-origin"], "*");
  assert.match(otvet.headers["access-control-allow-headers"], /authorization/i);
  assert.match(otvet.headers["access-control-allow-methods"], /POST/);
  await app.close();
});

test("без токена и с кривым — 401 net_vhoda, с CORS", async () => {
  const { app } = await server();
  for (const avtorizaciya of [null, "Bearer musor", "Bearer " + sdelatToken(sozdatKlyuch(KLYUCH.kid))]) {
    const otvet = await golos(app, { avtorizaciya });
    assert.equal(otvet.statusCode, 401, String(avtorizaciya).slice(0, 20));
    assert.deepEqual(otvet.json(), { oshibka: "net_vhoda" });
    assert.equal(otvet.headers["access-control-allow-origin"], "*");
  }
  await app.close();
});

test("истёкший токен — 401", async () => {
  const { app } = await server();
  const sek = Math.floor(Date.now() / 1000) - 7200;
  const otvet = await golos(app, { avtorizaciya: "Bearer " + sdelatToken(KLYUCH, {}, { seychasSek: sek }) });
  assert.equal(otvet.statusCode, 401);
  await app.close();
});

test("JWKS недоступен — 503 vhod_nedostupen", async () => {
  const { app } = await server({ vhod: vhodNaSvoyomKlyuche({ padaet: true }) });
  const otvet = await golos(app);
  assert.equal(otvet.statusCode, 503);
  assert.deepEqual(otvet.json(), { oshibka: "vhod_nedostupen" });
  await app.close();
});

test("верный вход и webm — 200 { status, text }", async () => {
  const google = googleOtvechaet({ status: "ok", text: "Текст Яна." });
  const { app, stroki } = await server({ google });
  const otvet = await golos(app);
  assert.equal(otvet.statusCode, 200);
  assert.deepEqual(otvet.json(), { status: "ok", text: "Текст Яна." });
  assert.equal(otvet.headers["access-control-allow-origin"], "*");
  assert.equal(otvet.headers["cache-control"], "no-store");
  assert.equal(google.vyzovy[0].telo.contents[0].parts[0].inlineData.mimeType, "audio/webm");
  // журнал — длины и коды, без текста Яна
  assert.ok(stroki.some((s) => s.startsWith("diktovka_ok")));
  assert.ok(!stroki.join("\n").includes("Текст Яна"));
  await app.close();
});

test("mp4, ogg, wav — принимаются", async () => {
  const { app } = await server();
  for (const tip of ["audio/mp4", "audio/ogg;codecs=opus", "audio/wav"]) {
    const otvet = await golos(app, { tip });
    assert.equal(otvet.statusCode, 200, tip);
  }
  await app.close();
});

test("больше 10 МБ — 413 golos_bolshoy", async () => {
  const { app } = await server();
  const otvet = await golos(app, { telo: Buffer.alloc(PREDEL_BAYT + 1) });
  assert.equal(otvet.statusCode, 413);
  assert.deepEqual(otvet.json(), { oshibka: "golos_bolshoy" });
  assert.equal(otvet.headers["access-control-allow-origin"], "*");
  await app.close();
});

test("ровно 10 МБ — проходит", async () => {
  const { app } = await server();
  const otvet = await golos(app, { telo: Buffer.alloc(PREDEL_BAYT) });
  assert.equal(otvet.statusCode, 200);
  await app.close();
});

test("чужой тип — 415 golos_tip (и audio/mpeg корня Sunray, и json, и flac)", async () => {
  const { app } = await server();
  const sluchai = [
    ["audio/flac", Buffer.from("x")],
    ["audio/mpeg", Buffer.from("x")],
    ["application/json", JSON.stringify({ a: 1 })],
    ["text/plain", "privet"],
  ];
  for (const [tip, telo] of sluchai) {
    const otvet = await golos(app, { tip, telo });
    assert.equal(otvet.statusCode, 415, tip);
    assert.deepEqual(otvet.json(), { oshibka: "golos_tip" }, tip);
  }
  await app.close();
});

test("пустое тело и тишина модели — 422 golos_tishina", async () => {
  const { app } = await server({ google: googleOtvechaet({ status: "empty", text: "" }) });
  assert.equal((await golos(app, { telo: Buffer.alloc(0) })).statusCode, 422);
  const otvet = await golos(app);
  assert.equal(otvet.statusCode, 422);
  assert.deepEqual(otvet.json(), { oshibka: "golos_tishina" });
  await app.close();
});

test("сбой и тайм-аут модели — 502 golos_sboy и 504 golos_dolgo", async () => {
  const sboy = await server({ google: googleOtvechaet({}, { finishReason: "SAFETY" }) });
  const o1 = await golos(sboy.app);
  assert.equal(o1.statusCode, 502);
  assert.deepEqual(o1.json(), { oshibka: "golos_sboy" });
  assert.ok(sboy.stroki.some((s) => s.includes('"prichina":"safety"')));
  await sboy.app.close();

  const dolgo = await server({
    google: sozdatGoogle({
      istochnik: { proekt: () => "p", klient: async () => ({ request: () => new Promise(() => {}) }) },
      zhurnal: () => {},
      taymautMs: 30,
    }),
  });
  const o2 = await golos(dolgo.app);
  assert.equal(o2.statusCode, 504);
  assert.deepEqual(o2.json(), { oshibka: "golos_dolgo" });
  await dolgo.app.close();
});

test("ошибка модели через адрес — ни в журнале, ни в логе Fastify нет base64 и токена", async () => {
  const audio = Buffer.from("golos-yana-dlinnyy-".repeat(400));
  const base64 = audio.toString("base64");
  const logi = [];
  const logStream = new Writable({
    write(kusok, _k, gotovo) {
      logi.push(String(kusok));
      gotovo();
    },
  });
  const pechat = [];
  const originaly = { warn: console.warn, error: console.error, log: console.log };
  for (const imya of Object.keys(originaly)) console[imya] = (...a) => pechat.push(a.map(String).join(" "));
  try {
    const { app, stroki } = await server(
      {
        google: sozdatGoogle({
          istochnik: {
            proekt: () => "p",
            klient: async () => ({
              request: async (opts) => {
                const o = new Error("Request failed with status code 400");
                o.config = { ...opts, headers: { Authorization: "Bearer ya29.SEKRET" } };
                o.response = { status: 400, config: o.config };
                throw o;
              },
            }),
          },
          // журнал по умолчанию — console.warn: проверяем настоящий путь печати
        }),
        zhurnal: undefined,
      },
      logStream,
    );
    const otvet = await golos(app, { telo: audio });
    assert.equal(otvet.statusCode, 502);
    await app.close();
    const vse = [...pechat, ...logi, ...stroki].join("\n");
    assert.ok(pechat.some((s) => s.includes("google_sboy")), "сбой записан");
    assert.ok(!vse.includes(base64.slice(0, 40)), "base64 аудио в журнале");
    assert.ok(!vse.includes("ya29"), "токен Google в журнале");
    assert.ok(!otvet.body.includes(base64.slice(0, 40)));
  } finally {
    Object.assign(console, originaly);
  }
});

test("корень Sunray не задет: /ping, свой audio/mpeg, свои ошибки, чужой webm", async () => {
  const { app } = await server();
  assert.deepEqual((await app.inject({ method: "GET", url: "/ping" })).json(), { status: "pong" });
  const mp3 = await app.inject({
    method: "POST",
    url: "/internal/recording-upload",
    headers: { "content-type": "audio/mpeg" },
    payload: Buffer.alloc(11 * 1024 * 1024),
  });
  assert.equal(mp3.statusCode, 200, "55 МБ корня живы, наш предел 10 МБ их не режет");
  const padaet = await app.inject({ method: "GET", url: "/padaet" });
  assert.equal(padaet.statusCode, 500);
  assert.equal(padaet.json().oshibka, undefined, "обработчик ошибок области не вышел на корень");
  const webm = await app.inject({
    method: "POST",
    url: "/internal/recording-upload",
    headers: { "content-type": "audio/webm" },
    payload: Buffer.from("x"),
  });
  assert.equal(webm.statusCode, 415, "наши разборы живут только в области");
  await app.close();
});
