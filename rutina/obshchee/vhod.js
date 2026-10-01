"use strict";

// Проверка «это вход RUTINA» по подписи токена, без секретов.
// База RUTINA подписывает токены входа ES256; открытые ключи — JWKS базы.
// Только встроенный crypto Node, без новых пакетов (закон 2 гостя).

const crypto = require("crypto");
const { zhurnalPoUmolchaniyu } = require("./otvety");

const ISS_RUTINA = "https://jvudpxpscjbhmbqvzpxo.supabase.co/auth/v1";
const JWKS_RUTINA = ISS_RUTINA + "/.well-known/jwks.json";
const AUD_RUTINA = "authenticated";

const ZAPAS_SEK = 30; // запас на разницу часов, для exp и iat
const PAUZA_MS = 60 * 1000; // незнакомый kid — перечитать не чаще раза в минуту
const PAUZA_POSLE_SBOYA_MS = 10 * 1000; // JWKS не ответил — повторить не раньше
const TAYMAUT_JWKS_MS = 5 * 1000;
const PREDEL_TOKENA = 8 * 1024;

function izBase64url(kusok) {
  if (typeof kusok !== "string" || !/^[A-Za-z0-9_-]*$/.test(kusok)) return null;
  return Buffer.from(kusok, "base64url");
}

function jsonIzBase64url(kusok) {
  const bufer = izBase64url(kusok);
  if (!bufer) return null;
  try {
    const znachenie = JSON.parse(bufer.toString("utf8"));
    return znachenie && typeof znachenie === "object" && !Array.isArray(znachenie) ? znachenie : null;
  } catch {
    return null;
  }
}

// "Bearer <токен>" → токен или null.
function tokenIzZagolovka(zagolovok) {
  if (typeof zagolovok !== "string") return null;
  const sovpadenie = /^Bearer[ ]+([^ ]+)[ ]*$/i.exec(zagolovok);
  if (!sovpadenie) return null;
  const token = sovpadenie[1];
  if (token.length > PREDEL_TOKENA) return null;
  return token;
}

// Токен → части или null. Подпись ES256 — ровно 64 байта (r||s).
function razobratToken(token) {
  if (typeof token !== "string") return null;
  const chasti = token.split(".");
  if (chasti.length !== 3) return null;
  const zagolovok = jsonIzBase64url(chasti[0]);
  const dannye = jsonIzBase64url(chasti[1]);
  const podpis = izBase64url(chasti[2]);
  if (!zagolovok || !dannye || !podpis) return null;
  if (zagolovok.alg !== "ES256") return null;
  if (typeof zagolovok.kid !== "string" || !zagolovok.kid || zagolovok.kid.length > 200) return null;
  if (podpis.length !== 64) return null;
  return { zagolovok, dannye, podpisannoe: chasti[0] + "." + chasti[1], podpis };
}

// Свойства токена: издатель, адресат, срок, роль, не аноним.
function dannyeVernye(dannye, { iss, aud, seychasSek, zapasSek = ZAPAS_SEK }) {
  if (!dannye || typeof dannye !== "object") return false;
  if (dannye.iss !== iss) return false;
  const adresaty = Array.isArray(dannye.aud) ? dannye.aud : [dannye.aud];
  if (!adresaty.includes(aud)) return false;
  if (typeof dannye.exp !== "number" || !Number.isFinite(dannye.exp)) return false;
  if (dannye.exp + zapasSek <= seychasSek) return false;
  if (typeof dannye.iat === "number" && dannye.iat - zapasSek > seychasSek) return false;
  if (typeof dannye.nbf === "number" && dannye.nbf - zapasSek > seychasSek) return false;
  if (dannye.role !== "authenticated") return false;
  if (dannye.is_anonymous === true) return false;
  if (typeof dannye.sub !== "string" || !dannye.sub) return false;
  return true;
}

// Ключ JWKS → KeyObject, только EC P-256 для подписи.
function klyuchIzJwk(jwk) {
  if (!jwk || typeof jwk !== "object") return null;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
  if (jwk.alg !== undefined && jwk.alg !== "ES256") return null;
  if (jwk.use !== undefined && jwk.use !== "sig") return null;
  if (typeof jwk.kid !== "string" || !jwk.kid) return null;
  try {
    return crypto.createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: "jwk",
    });
  } catch {
    return null;
  }
}

function podpisVernaya(chasti, klyuch) {
  try {
    return crypto.verify(
      "sha256",
      Buffer.from(chasti.podpisannoe, "utf8"),
      { key: klyuch, dsaEncoding: "ieee-p1363" },
      chasti.podpis,
    );
  } catch {
    return false;
  }
}

async function zagruzitPoSeti(adres) {
  const otvet = await fetch(adres, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TAYMAUT_JWKS_MS),
  });
  if (!otvet.ok) {
    const oshibka = new Error("jwks_status");
    oshibka.status = otvet.status;
    throw oshibka;
  }
  return otvet.json();
}

// Проверка входа с кэшем ключей. Всё внешнее — параметрами, чтобы тесты
// шли на своём ключе и своих часах.
function sozdatVhod({
  adresKlyuchey = JWKS_RUTINA,
  iss = ISS_RUTINA,
  aud = AUD_RUTINA,
  zagruzit = zagruzitPoSeti,
  seychas = Date.now,
  pauzaMs = PAUZA_MS,
  pauzaPosleSboyaMs = PAUZA_POSLE_SBOYA_MS,
  zhurnal = zhurnalPoUmolchaniyu,
} = {}) {
  let klyuchi = new Map();
  let bylaPopytka = false;
  let poslednyayaPopytka = 0;
  let poslednyayaUdalas = false;
  let vPuti = null;

  function obnovit() {
    if (vPuti) return vPuti;
    bylaPopytka = true;
    poslednyayaPopytka = seychas();
    vPuti = (async () => {
      try {
        const nabor = await zagruzit(adresKlyuchey);
        const novye = new Map();
        for (const jwk of (nabor && Array.isArray(nabor.keys) ? nabor.keys : [])) {
          const klyuch = klyuchIzJwk(jwk);
          if (klyuch) novye.set(jwk.kid, klyuch);
        }
        if (novye.size === 0) throw new Error("jwks_pusto");
        klyuchi = novye;
        poslednyayaUdalas = true;
      } catch (oshibka) {
        // Старые ключи остаются: сбой сети не выгоняет вошедшего.
        poslednyayaUdalas = false;
        zhurnal("vhod_jwks_nedostupen", {
          status: oshibka && typeof oshibka.status === "number" ? oshibka.status : null,
          imya: oshibka && typeof oshibka.name === "string" ? oshibka.name.slice(0, 40) : null,
        });
      } finally {
        vPuti = null;
      }
    })();
    return vPuti;
  }

  async function naytiKlyuch(kid) {
    if (klyuchi.has(kid)) return { klyuch: klyuchi.get(kid) };
    if (vPuti) {
      await vPuti;
    } else {
      const pauza = poslednyayaUdalas ? pauzaMs : pauzaPosleSboyaMs;
      if (!bylaPopytka || seychas() - poslednyayaPopytka >= pauza) await obnovit();
    }
    if (klyuchi.has(kid)) return { klyuch: klyuchi.get(kid) };
    return { kod: poslednyayaUdalas ? "net_vhoda" : "vhod_nedostupen" };
  }

  // Заголовок Authorization → { ok: true, sub } или { ok: false, kod }.
  async function proverit(zagolovok) {
    const token = tokenIzZagolovka(zagolovok);
    const chasti = token && razobratToken(token);
    if (!chasti) return { ok: false, kod: "net_vhoda" };
    const seychasSek = Math.floor(seychas() / 1000);
    // Свойства — до ключей: просроченный или чужой токен не дёргает JWKS.
    if (!dannyeVernye(chasti.dannye, { iss, aud, seychasSek })) return { ok: false, kod: "net_vhoda" };
    const nayden = await naytiKlyuch(chasti.zagolovok.kid);
    if (!nayden.klyuch) return { ok: false, kod: nayden.kod };
    if (!podpisVernaya(chasti, nayden.klyuch)) return { ok: false, kod: "net_vhoda" };
    return { ok: true, sub: chasti.dannye.sub };
  }

  return { proverit };
}

module.exports = {
  ISS_RUTINA,
  JWKS_RUTINA,
  AUD_RUTINA,
  tokenIzZagolovka,
  razobratToken,
  dannyeVernye,
  klyuchIzJwk,
  sozdatVhod,
};
