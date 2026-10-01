"use strict";

// Свой клиент Google для RUTINA: токен сервис-аккаунта Sunray (только чтение
// переменной), вызов модели Gemini на Vertex. Клиенты Sunray (call-ai,
// assistant, lib) не зовём — закон 2 гостя.
//
// Журнал чистый: ошибка gaxios несёт тело запроса (весь base64 аудио) и
// заголовки с токеном — её не печатаем и не пробрасываем. Пишем только
// статус, короткий код и длины.

const { OshibkaRutiny, zhurnalPoUmolchaniyu } = require("./otvety");

const MODEL = "gemini-3.5-flash-lite";
const ZAPASNAYA_MODEL = "gemini-3-flash-preview"; // если основной ответит 404
const REGION = "global";
const TAYMAUT_MS = 45 * 1000; // браузер ждёт 60 с
const OBLAST_DOSTUPA = "https://www.googleapis.com/auth/cloud-platform";

function adresModeli(proekt, model, region = REGION) {
  const hozt = region === "global" ? "aiplatform.googleapis.com" : `${region}-aiplatform.googleapis.com`;
  return (
    `https://${hozt}/v1/projects/${encodeURIComponent(proekt)}` +
    `/locations/${region}/publishers/google/models/${model}:generateContent`
  );
}

// Ключ сервис-аккаунта из переменной Sunray — только читаем.
function chitatKlyuch(okruzhenie = process.env) {
  const syroe = okruzhenie.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!syroe) throw new OshibkaRutiny("golos_sboy", "net_klyucha");
  let credentials;
  try {
    credentials = JSON.parse(syroe);
  } catch {
    throw new OshibkaRutiny("golos_sboy", "klyuch_ne_json");
  }
  if (!credentials || typeof credentials.project_id !== "string" || !credentials.project_id) {
    throw new OshibkaRutiny("golos_sboy", "klyuch_bez_proekta");
  }
  return { credentials, proekt: credentials.project_id };
}

function bezopasnyyKod(znachenie) {
  if (typeof znachenie === "number") return String(znachenie);
  if (typeof znachenie === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(znachenie)) return znachenie;
  return null;
}

function etoTaymaut(oshibka) {
  if (!oshibka) return false;
  const tipy = [oshibka.type, oshibka.error && oshibka.error.type, oshibka.code, oshibka.name];
  return tipy.some((t) => t === "request-timeout" || t === "body-timeout" || t === "AbortError" || t === "ETIMEDOUT" || t === "ECONNABORTED");
}

// Ошибка вызова (gaxios и любая другая) → своя ошибка с коротким полем.
// Исходная ошибка дальше этой функции не уходит.
function perevestiOshibku(oshibka, { model, dlinaZaprosa, zhurnal }) {
  const status = oshibka && oshibka.response && typeof oshibka.response.status === "number" ? oshibka.response.status : null;
  const kod = bezopasnyyKod(oshibka && oshibka.code);
  if (etoTaymaut(oshibka)) {
    zhurnal("google_dolgo", { model, dlinaZaprosa });
    return new OshibkaRutiny("golos_dolgo", "taymaut");
  }
  zhurnal("google_sboy", { model, status, kod, dlinaZaprosa });
  if (status === 404) return new OshibkaRutiny("golos_sboy", "net_modeli");
  return new OshibkaRutiny("golos_sboy", status ? `status_${status}` : "set");
}

function klientPoUmolchaniyu(okruzhenie = process.env) {
  let obeshchanie = null;
  let proekt = null;
  return {
    proekt() {
      if (!proekt) proekt = chitatKlyuch(okruzhenie).proekt;
      return proekt;
    },
    klient() {
      if (!obeshchanie) {
        obeshchanie = (async () => {
          const { credentials } = chitatKlyuch(okruzhenie);
          // googleapis у Sunray уже стоит; грузим лениво, при первом голосе.
          const { google } = require("googleapis");
          const auth = new google.auth.GoogleAuth({ credentials, scopes: [OBLAST_DOSTUPA] });
          return auth.getClient();
        })();
        // Не удалось — следующий вызов попробует заново, без вечного кэша сбоя.
        obeshchanie.catch(() => {
          obeshchanie = null;
        });
      }
      return obeshchanie;
    },
  };
}

// istochnik: { proekt(): string, klient(): Promise<{ request(opts) }> }.
function sozdatGoogle({
  istochnik = klientPoUmolchaniyu(),
  modeli = [MODEL, ZAPASNAYA_MODEL],
  region = REGION,
  taymautMs = TAYMAUT_MS,
  zhurnal = zhurnalPoUmolchaniyu,
  seychas = Date.now,
} = {}) {
  async function odinVyzov(model, telo, dlinaZaprosa, srok) {
    const ostalos = srok - seychas();
    if (ostalos <= 0) throw new OshibkaRutiny("golos_dolgo", "taymaut");
    const otmena = new AbortController();
    let tajmer = null;
    const taymaut = new Promise((_, otkaz) => {
      tajmer = setTimeout(() => {
        otmena.abort();
        otkaz(new OshibkaRutiny("golos_dolgo", "taymaut"));
      }, ostalos);
    });
    taymaut.catch(() => {});
    try {
      let proekt;
      let klient;
      try {
        proekt = istochnik.proekt();
        klient = await istochnik.klient();
      } catch (oshibka) {
        if (oshibka instanceof OshibkaRutiny) {
          zhurnal("google_klyuch", { prichina: oshibka.prichina });
          throw oshibka;
        }
        zhurnal("google_token", { imya: bezopasnyyKod(oshibka && oshibka.name) });
        throw new OshibkaRutiny("golos_sboy", "token");
      }
      const zapros = klient.request({
        url: adresModeli(proekt, model, region),
        method: "POST",
        data: telo,
        timeout: ostalos,
        retry: false,
        signal: otmena.signal,
        responseType: "json",
      });
      zapros.catch(() => {});
      const otvet = await Promise.race([zapros, taymaut]);
      return otvet && otvet.data;
    } catch (oshibka) {
      if (oshibka instanceof OshibkaRutiny) throw oshibka;
      throw perevestiOshibku(oshibka, { model, dlinaZaprosa, zhurnal });
    } finally {
      clearTimeout(tajmer);
    }
  }

  // telo — тело generateContent. Ответ — { data, model }.
  async function sprositModel(telo, { dlinaZaprosa = null } = {}) {
    const srok = seychas() + taymautMs;
    for (let i = 0; i < modeli.length; i += 1) {
      const model = modeli[i];
      try {
        const data = await odinVyzov(model, telo, dlinaZaprosa, srok);
        return { data, model };
      } catch (oshibka) {
        const estZapasnaya = i < modeli.length - 1;
        if (estZapasnaya && oshibka instanceof OshibkaRutiny && oshibka.prichina === "net_modeli") continue;
        throw oshibka;
      }
    }
    throw new OshibkaRutiny("golos_sboy", "net_modeli");
  }

  return { sprositModel };
}

module.exports = {
  MODEL,
  ZAPASNAYA_MODEL,
  REGION,
  TAYMAUT_MS,
  adresModeli,
  chitatKlyuch,
  perevestiOshibku,
  klientPoUmolchaniyu,
  sozdatGoogle,
};
