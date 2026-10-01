"use strict";

// Помощники тестов RUTINA: свой ключ ES256, токены, сервер «как Sunray».
// Живых вызовов нет: ни Supabase, ни Google.

const crypto = require("crypto");
const { ISS_RUTINA, AUD_RUTINA } = require("../obshchee/vhod");

function sozdatKlyuch(kid = "klyuch-testa") {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" };
  return { kid, privateKey, jwk };
}

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function sdelatToken(klyuch, dannye = {}, { seychasSek = Math.floor(Date.now() / 1000), zagolovok = {} } = {}) {
  const shapka = { alg: "ES256", typ: "JWT", kid: klyuch.kid, ...zagolovok };
  const telo = {
    iss: ISS_RUTINA,
    aud: AUD_RUTINA,
    sub: "00000000-0000-4000-8000-000000000001",
    role: "authenticated",
    is_anonymous: false,
    iat: seychasSek,
    exp: seychasSek + 3600,
    ...dannye,
  };
  const podpisannoe = b64(shapka) + "." + b64(telo);
  const podpis = crypto.sign("sha256", Buffer.from(podpisannoe), {
    key: klyuch.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return podpisannoe + "." + podpis.toString("base64url");
}

// Сервер «как Sunray»: тот же корень, что в server.js, — bodyLimit 55 МБ,
// @fastify/cors origin '*', formbody, корневой разбор audio/mpeg (call-ai),
// корневой /ping; потом наша область.
function sobratKakSunray({ nastroyki, logStream } = {}) {
  const fastify = require("fastify")({
    logger: logStream ? { level: "warn", stream: logStream } : false,
    bodyLimit: 55 * 1024 * 1024,
  });
  // Порядок — как в server.js: cors и formbody, потом call-ai вешает
  // audio/mpeg на корень, потом наша строка, потом /ping.
  fastify.register(require("@fastify/cors"), { origin: "*", methods: ["GET", "POST", "OPTIONS"] });
  fastify.register(require("@fastify/formbody"));
  fastify.addContentTypeParser("audio/mpeg", { parseAs: "buffer", bodyLimit: 55 * 1024 * 1024 }, (_r, telo, gotovo) =>
    gotovo(null, telo),
  );
  fastify.post("/internal/recording-upload", async (req) => ({ size: req.body.length }));
  fastify.get("/padaet", async () => {
    throw new Error("korenovaya oshibka");
  });
  require("../index")(fastify, nastroyki);
  fastify.get("/ping", async () => ({ status: "pong" }));
  return fastify;
}

// Подмена Google: отвечает заданным текстом модели.
function googleOtvechaet(json, { finishReason = "STOP" } = {}) {
  const vyzovy = [];
  return {
    vyzovy,
    async sprositModel(telo, opts) {
      vyzovy.push({ telo, opts });
      return {
        model: "testovaya",
        data: { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(json) }] } }] },
      };
    },
  };
}

function zhurnalVPamyat() {
  const stroki = [];
  const zhurnal = (sobytie, polya) => stroki.push(sobytie + " " + JSON.stringify(polya || {}));
  return { stroki, zhurnal };
}

module.exports = { sozdatKlyuch, sdelatToken, sobratKakSunray, googleOtvechaet, zhurnalVPamyat };
