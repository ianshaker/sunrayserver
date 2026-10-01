"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ISS_RUTINA,
  tokenIzZagolovka,
  razobratToken,
  dannyeVernye,
  klyuchIzJwk,
  sozdatVhod,
} = require("./vhod");
const { sozdatKlyuch, sdelatToken, zhurnalVPamyat } = require("../testy/pomoshchniki");

const NACHALO_MS = 1_800_000_000_000;

function stend({ klyuchi, padaet = false } = {}) {
  let seychas = NACHALO_MS;
  let zagruzok = 0;
  let nabor = { keys: klyuchi.map((k) => k.jwk) };
  const { stroki, zhurnal } = zhurnalVPamyat();
  const vhod = sozdatVhod({
    seychas: () => seychas,
    zhurnal,
    zagruzit: async () => {
      zagruzok += 1;
      if (padaet) throw Object.assign(new Error("net seti"), { name: "TypeError" });
      return nabor;
    },
  });
  return {
    vhod,
    stroki,
    zagruzok: () => zagruzok,
    proyti: (ms) => {
      seychas += ms;
    },
    seychasSek: () => Math.floor(seychas / 1000),
    smenitNabor: (k) => {
      nabor = { keys: k.map((x) => x.jwk) };
    },
    ustanovitPadenie: (p) => {
      padaet = p;
    },
  };
}

test("заголовок: только Bearer и один токен", () => {
  assert.equal(tokenIzZagolovka("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(tokenIzZagolovka("bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(tokenIzZagolovka("Basic abc"), null);
  assert.equal(tokenIzZagolovka("Bearer"), null);
  assert.equal(tokenIzZagolovka("Bearer a b"), null);
  assert.equal(tokenIzZagolovka(undefined), null);
  assert.equal(tokenIzZagolovka("Bearer " + "a".repeat(9000)), null);
});

test("разбор токена: только ES256 с kid и подписью 64 байта", () => {
  const k = sozdatKlyuch();
  assert.ok(razobratToken(sdelatToken(k)));
  assert.equal(razobratToken("a.b"), null);
  assert.equal(razobratToken(sdelatToken(k, {}, { zagolovok: { alg: "HS256" } })), null);
  assert.equal(razobratToken(sdelatToken(k, {}, { zagolovok: { alg: "none" } })), null);
  assert.equal(razobratToken(sdelatToken(k, {}, { zagolovok: { kid: undefined } })), null);
  const [z, d] = sdelatToken(k).split(".");
  assert.equal(razobratToken(`${z}.${d}.`), null);
  assert.equal(razobratToken(`${z}.${d}.%%%`), null);
});

test("свойства токена: iss, aud, exp с запасом 30 с, роль, не аноним", () => {
  const s = 1_800_000_000;
  const vernye = { iss: ISS_RUTINA, aud: "authenticated", exp: s + 60, role: "authenticated", sub: "u" };
  const o = { iss: ISS_RUTINA, aud: "authenticated", seychasSek: s };
  assert.equal(dannyeVernye(vernye, o), true);
  assert.equal(dannyeVernye({ ...vernye, aud: ["x", "authenticated"] }, o), true);
  assert.equal(dannyeVernye({ ...vernye, exp: s - 10 }, o), true, "запас на часы");
  assert.equal(dannyeVernye({ ...vernye, exp: s - 30 }, o), false);
  assert.equal(dannyeVernye({ ...vernye, exp: undefined }, o), false);
  assert.equal(dannyeVernye({ ...vernye, iss: "https://chuzhoy.supabase.co/auth/v1" }, o), false);
  assert.equal(dannyeVernye({ ...vernye, aud: "anon" }, o), false);
  assert.equal(dannyeVernye({ ...vernye, role: "anon" }, o), false);
  assert.equal(dannyeVernye({ ...vernye, is_anonymous: true }, o), false);
  assert.equal(dannyeVernye({ ...vernye, sub: "" }, o), false);
  assert.equal(dannyeVernye({ ...vernye, iat: s + 120 }, o), false);
});

test("ключ JWKS: только EC P-256", () => {
  const k = sozdatKlyuch();
  assert.ok(klyuchIzJwk(k.jwk));
  assert.equal(klyuchIzJwk({ ...k.jwk, crv: "P-384" }), null);
  assert.equal(klyuchIzJwk({ ...k.jwk, alg: "RS256" }), null);
  assert.equal(klyuchIzJwk({ kty: "oct", k: "abc", kid: "x" }), null);
  assert.equal(klyuchIzJwk({ ...k.jwk, x: "plokho" }), null);
});

test("верный токен своего ключа — вход", async () => {
  const k = sozdatKlyuch();
  const s = stend({ klyuchi: [k] });
  const itog = await s.vhod.proverit("Bearer " + sdelatToken(k, {}, { seychasSek: s.seychasSek() }));
  assert.deepEqual(itog, { ok: true, sub: "00000000-0000-4000-8000-000000000001" });
  assert.equal(s.zagruzok(), 1);
  // второй раз — из кэша
  await s.vhod.proverit("Bearer " + sdelatToken(k, {}, { seychasSek: s.seychasSek() }));
  assert.equal(s.zagruzok(), 1);
});

test("подделка: чужой ключ с тем же kid, правленые данные", async () => {
  const k = sozdatKlyuch("odin");
  const chuzhoy = sozdatKlyuch("odin");
  const s = stend({ klyuchi: [k] });
  const sek = s.seychasSek();
  assert.deepEqual(await s.vhod.proverit("Bearer " + sdelatToken(chuzhoy, {}, { seychasSek: sek })), {
    ok: false,
    kod: "net_vhoda",
  });
  const [z, , p] = sdelatToken(k, {}, { seychasSek: sek }).split(".");
  const pravlenye = Buffer.from(
    JSON.stringify({ iss: ISS_RUTINA, aud: "authenticated", role: "authenticated", sub: "drugoy", exp: sek + 3600 }),
  ).toString("base64url");
  assert.equal((await s.vhod.proverit(`Bearer ${z}.${pravlenye}.${p}`)).kod, "net_vhoda");
});

test("истёк, чужой iss или aud, аноним — 401 и JWKS не трогаем", async () => {
  const k = sozdatKlyuch();
  const s = stend({ klyuchi: [k] });
  const sek = s.seychasSek();
  const plokhie = [
    { exp: sek - 3600 },
    { iss: "https://drugaya.supabase.co/auth/v1" },
    { aud: "anon" },
    { is_anonymous: true },
    { role: "anon" },
  ];
  for (const dannye of plokhie) {
    const itog = await s.vhod.proverit("Bearer " + sdelatToken(k, dannye, { seychasSek: sek }));
    assert.deepEqual(itog, { ok: false, kod: "net_vhoda" }, JSON.stringify(dannye));
  }
  assert.equal(await s.vhod.proverit(undefined).then((i) => i.kod), "net_vhoda");
  assert.equal(await s.vhod.proverit("Bearer musor").then((i) => i.kod), "net_vhoda");
  assert.equal(s.zagruzok(), 0);
});

test("незнакомый kid — JWKS перечитывается не чаще раза в минуту", async () => {
  const k = sozdatKlyuch("izvestnyy");
  const novyy = sozdatKlyuch("novyy");
  const s = stend({ klyuchi: [k] });
  const token = () => "Bearer " + sdelatToken(novyy, {}, { seychasSek: s.seychasSek() });
  assert.equal((await s.vhod.proverit(token())).kod, "net_vhoda");
  assert.equal(s.zagruzok(), 1);
  for (let i = 0; i < 20; i += 1) {
    s.proyti(1000);
    assert.equal((await s.vhod.proverit(token())).kod, "net_vhoda");
  }
  assert.equal(s.zagruzok(), 1, "двадцать подделок за 20 с — ни одной лишней загрузки");
  // Прошла минута, база сменила ключ — новый kid принят.
  s.proyti(41_000);
  s.smenitNabor([k, novyy]);
  assert.equal((await s.vhod.proverit(token())).ok, true);
  assert.equal(s.zagruzok(), 2);
});

test("одновременные запросы с незнакомым kid — одна загрузка", async () => {
  const k = sozdatKlyuch();
  const s = stend({ klyuchi: [k] });
  const t = "Bearer " + sdelatToken(k, {}, { seychasSek: s.seychasSek() });
  const itogi = await Promise.all([s.vhod.proverit(t), s.vhod.proverit(t), s.vhod.proverit(t)]);
  assert.ok(itogi.every((i) => i.ok));
  assert.equal(s.zagruzok(), 1);
});

test("JWKS недоступен — 503 vhod_nedostupen, а не 401; известный ключ живёт", async () => {
  const k = sozdatKlyuch();
  const s = stend({ klyuchi: [k], padaet: true });
  const t = () => "Bearer " + sdelatToken(k, {}, { seychasSek: s.seychasSek() });
  assert.deepEqual(await s.vhod.proverit(t()), { ok: false, kod: "vhod_nedostupen" });
  assert.ok(s.stroki.some((x) => x.startsWith("vhod_jwks_nedostupen")));
  // После сбоя повтор не раньше 10 с.
  s.proyti(5000);
  assert.equal((await s.vhod.proverit(t())).kod, "vhod_nedostupen");
  assert.equal(s.zagruzok(), 1);
  s.ustanovitPadenie(false);
  s.proyti(6000);
  assert.equal((await s.vhod.proverit(t())).ok, true);
  assert.equal(s.zagruzok(), 2);
  // Сеть снова легла — известный ключ всё равно проверяет.
  s.ustanovitPadenie(true);
  s.proyti(120_000);
  assert.equal((await s.vhod.proverit(t())).ok, true);
});
