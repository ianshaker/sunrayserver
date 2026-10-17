"use strict";

// Журнал сырых событий Mango: таблица mango_events (миграция 20261017130000_mango_events.sql,
// договор «прокси Mango ↔ Render», З5). Пишет только Render, service_role-клиентом сервера
// (lib/supabaseClient.js). Ключ клиента — только из env, здесь его нет.
// Колонка obrabotano: true — обработчик ответил кодом меньше 500 (или событие только записано без обработчика);
// false — ещё не ответил, упал или ответил 5xx. Повтор с тем же ключом: true — дубль, false — обработать снова.
// Колонка vzyato (аренда): кто взял событие в работу, тот и держит его 60 с; повтор в это время получает «занято» (503).
// Это защита от повтора, а не гарантия «ровно один раз»: обработчик, упавший посередине, будет вызван снова.
// В логи не пишем тело события, телефоны и подписи: только путь, entry_id и текст ошибки.

const crypto = require("crypto");

const TABLITSA = "mango_events";
const KHRANIT_DNEY = 90;
const CHISTKA_PERIOD_MS = 24 * 60 * 60 * 1000;
// Журнал не должен задерживать звонок: база молчит дольше — это ошибка записи.
const ZAPIS_TAIMAUT_MS = 2000;
// Аренда события: пока обработчик работает (или упал недавно), повтор того же события ждёт.
const ARENDA_MS = 60 * 1000;
// В payload больше этого — храним только начало: {"_obrezano": true, "_razmer": N, "_nachalo": ...}.
const PAYLOAD_MAKS_BAJT = 64 * 1024;
const PAYLOAD_NACHALO_BAJT = 4 * 1024;
// Поля формы Mango, которые в журнал не попадают (ни строкой, ни в разобранном json).
const SEKRETNYE_POLYA = ["vpbx_api_key", "sign"];

const VID_PO_PUTI = {
  "/events/call": "call",
  "/events/summary": "summary",
  "/events/recording": "recording",
  "/events/record/added": "record_added",
};

// Ключ события: sha256(path + '\n' + строка поля json как пришла), hex.
function klyuchSobytiya(path, json) {
  return crypto.createHash("sha256").update(`${path}\n${json}`).digest("hex");
}

function bezSekretov(obj) {
  const kopiya = { ...obj };
  for (const pole of SEKRETNYE_POLYA) delete kopiya[pole];
  return kopiya;
}

// Тело Mango: поля формы vpbx_api_key, sign, json (json — строка). Возвращает строку json «как пришла»
// и payload. Нет поля json (плоское тело, его принимает и handleMangoWebhook) — строкой служит
// тело без ключа и подписи. Не разобралось (не JSON или не объект) — payload = { _syroe: строка }.
function razobratTelo(telo) {
  const forma = telo && typeof telo === "object" && !Array.isArray(telo) ? telo : {};
  const stroka = typeof forma.json === "string" ? forma.json : JSON.stringify(bezSekretov(forma));
  let payload;
  try {
    const razobrano = JSON.parse(stroka);
    const obekt = razobrano && typeof razobrano === "object" && !Array.isArray(razobrano);
    payload = obekt ? bezSekretov(razobrano) : { _syroe: stroka };
  } catch {
    payload = { _syroe: stroka };
  }
  return { stroka, payload };
}

function idIliNull(znachenie) {
  if (typeof znachenie === "string" && znachenie !== "") return znachenie;
  if (typeof znachenie === "number" && Number.isFinite(znachenie)) return String(znachenie);
  return null;
}

// call_state, а если есть location — call_state@location.
function nazvanieSobytiya(payload) {
  const sostoyanie = idIliNull(payload.call_state);
  if (!sostoyanie) return null;
  const mesto = idIliNull(payload.location);
  return mesto ? `${sostoyanie}@${mesto}` : sostoyanie;
}

// Заголовок x-mango-prinyato → миллисекунды или null. Принимаем только ISO 8601 с Z или со смещением ±hh:mm;
// всё остальное («вчера», «Oct 17 2026», время без пояса) считается «нет заголовка».
const ISO_S_POYASOM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
function vremyaPrinyatiya(zagolovok) {
  if (typeof zagolovok !== "string") return null;
  const tekst = zagolovok.trim();
  if (!ISO_S_POYASOM.test(tekst)) return null;
  const ms = Date.parse(tekst);
  return Number.isFinite(ms) ? ms : null;
}

// Начало строки не длиннее baytov (без разрезанного символа и без NUL: jsonb его не хранит).
function nachaloStroki(stroka, bajt) {
  return Buffer.from(stroka, "utf8").subarray(0, bajt).toString("utf8").replace(/\u0000/g, "");
}

// Строка таблицы по событию. path — путь события (/events/call и т. д.), telo — поля формы Mango,
// prinyato — x-mango-prinyato, podpis — x-mango-podpis, povtor — досылка из очереди прокси.
function sobratZapis({ path, telo, prinyato = null, podpis = null, povtor = false }) {
  const { stroka, payload } = razobratTelo(telo);
  const vid = VID_PO_PUTI[path] || null;
  const prinyatoMs = vremyaPrinyatiya(prinyato);
  const razmer = Buffer.byteLength(stroka, "utf8");
  return {
    klyuch: klyuchSobytiya(path, stroka),
    path,
    vid,
    sobytie: vid === "call" ? nazvanieSobytiya(payload) : null,
    entry_id: idIliNull(payload.entry_id),
    call_id: idIliNull(payload.call_id),
    // Ключ, vid, sobytie и id взяты из полного json; в таблицу большое тело кладём обрезанным.
    payload:
      razmer > PAYLOAD_MAKS_BAJT
        ? { _obrezano: true, _razmer: razmer, _nachalo: nachaloStroki(stroka, PAYLOAD_NACHALO_BAJT) }
        : payload,
    prinyato: prinyatoMs === null ? null : new Date(prinyatoMs).toISOString(),
    podpis: typeof podpis === "string" && podpis.trim() !== "" ? podpis.trim().slice(0, 32) : null,
    povtor: Boolean(povtor),
  };
}

// Текст ошибки для лога: только код и сообщение, без details (в них бывает строка таблицы целиком).
function tekstOshibki(oshibka) {
  if (!oshibka) return "неизвестная ошибка";
  const soobshchenie = oshibka.message || String(oshibka);
  return oshibka.code ? `${oshibka.code}: ${soobshchenie}` : soobshchenie;
}

// Ждёт ответ базы не дольше taimautMs: молчание базы — ошибка записи, а не задержка звонка.
async function zhdat(zapros, taimautMs) {
  let taimer;
  try {
    const ozhidanie = new Promise((_, otkaz) => {
      taimer = setTimeout(
        () => otkaz(new Error(`${TABLITSA}: база не ответила за ${taimautMs} мс`)),
        taimautMs,
      );
    });
    return await Promise.race([zapros, ozhidanie]);
  } finally {
    clearTimeout(taimer);
  }
}

// INSERT ... ON CONFLICT (klyuch) DO NOTHING. Не бросает.
// Успех: { novoe, oshibka: null, id, obrabotano, zanyato }.
//   novoe: true — строку записали сейчас (и взяли в аренду: vzyato = сейчас); false — ключ уже был, id и obrabotano из старой строки.
//   obrabotano: true — это дубль, обработчик звать не надо.
//   zanyato: true — событие не обработано, но его держит другой заход (vzyato моложе 60 с) или аренду только что перехватили:
//            обрабатывать сейчас нельзя, ответить 503 (прокси повторит позже). Старше 60 с — берём заново (vzyato = сейчас).
// Ошибка базы (в том числе нет ответа за taimautMs): { novoe: null, oshibka } — сначала смотреть oshibka.
async function vstavitSobytie(supabase, zapis, { taimautMs = ZAPIS_TAIMAUT_MS, teper = Date.now } = {}) {
  try {
    const seychas = new Date(teper()).toISOString();
    // Строка, которую ещё надо обработать, сразу в аренде; «только запись» (obrabotano=true) аренды не имеет.
    const stroka = zapis.obrabotano === true ? zapis : { ...zapis, vzyato: seychas };
    const { data, error } = await zhdat(
      supabase.from(TABLITSA).upsert(stroka, { onConflict: "klyuch", ignoreDuplicates: true }).select("id"),
      taimautMs,
    );
    if (error) return { novoe: null, oshibka: error };
    // Любой ответ, кроме списка строк, — не дубль, а ошибка: событие надо обработать, а не потерять.
    if (!Array.isArray(data)) {
      return { novoe: null, oshibka: new Error(`${TABLITSA}: неожиданный ответ базы`) };
    }
    if (data.length > 0) {
      return { novoe: true, oshibka: null, id: data[0].id, obrabotano: zapis.obrabotano === true, zanyato: false };
    }

    // Пустой список: ключ уже есть. Смотрим, довели ли то событие до конца и держит ли его кто-то.
    const poisk = await zhdat(
      supabase.from(TABLITSA).select("id,obrabotano,vzyato").eq("klyuch", zapis.klyuch).limit(1),
      taimautMs,
    );
    if (poisk.error) return { novoe: null, oshibka: poisk.error };
    const staraya = Array.isArray(poisk.data) ? poisk.data[0] : null;
    if (!staraya) return { novoe: null, oshibka: new Error(`${TABLITSA}: ключ есть, а строки нет`) };
    if (staraya.obrabotano === true) {
      return { novoe: false, oshibka: null, id: staraya.id, obrabotano: true, zanyato: false };
    }

    const vzyatoMs = staraya.vzyato ? Date.parse(staraya.vzyato) : NaN;
    if (Number.isFinite(vzyatoMs) && teper() - vzyatoMs < ARENDA_MS) {
      return { novoe: false, oshibka: null, id: staraya.id, obrabotano: false, zanyato: true };
    }
    // Аренда истекла (или строку никто не брал): перехватываем одним условным update — кто успел, тот и взял.
    let perekhvat = supabase
      .from(TABLITSA)
      .update({ vzyato: seychas })
      .eq("id", staraya.id)
      .eq("obrabotano", false);
    perekhvat = Number.isFinite(vzyatoMs) ? perekhvat.eq("vzyato", staraya.vzyato) : perekhvat.is("vzyato", null);
    const vzyali = await zhdat(perekhvat.select("id"), taimautMs);
    if (vzyali.error) return { novoe: null, oshibka: vzyali.error };
    const zanyato = !Array.isArray(vzyali.data) || vzyali.data.length === 0;
    return { novoe: false, oshibka: null, id: staraya.id, obrabotano: false, zanyato };
  } catch (e) {
    return { novoe: null, oshibka: e };
  }
}

// Звонок уже закончился по журналу? Есть другое событие с тем же entry_id (ключ не свой): summary или call с Disconnected.
// Нужно для повтора call-события из очереди прокси: по законченному звонку живая карточка уже не нужна.
// Не бросает: { zavershen, oshibka }.
async function zvonokZavershen(supabase, entryId, svoyKlyuch, { taimautMs = ZAPIS_TAIMAUT_MS } = {}) {
  try {
    const { data, error } = await zhdat(
      supabase.from(TABLITSA).select("klyuch,vid,sobytie").eq("entry_id", entryId).limit(200),
      taimautMs,
    );
    if (error) return { zavershen: null, oshibka: error };
    const stroki = Array.isArray(data) ? data : [];
    const zavershen = stroki.some(
      (r) =>
        r.klyuch !== svoyKlyuch &&
        (r.vid === "summary" || (r.vid === "call" && typeof r.sobytie === "string" && r.sobytie.startsWith("Disconnected"))),
    );
    return { zavershen, oshibka: null };
  } catch (e) {
    return { zavershen: null, oshibka: e };
  }
}

// Итог ответа: obrabotano = (код < 500), kod = код — по id строки журнала этого запроса.
// Только пока строка не обработана (obrabotano = false): уже записанное true не затираем. Не бросает.
async function otmetitItog(supabase, id, kod, { taimautMs = ZAPIS_TAIMAUT_MS } = {}) {
  try {
    const { error } = await zhdat(
      supabase.from(TABLITSA).update({ obrabotano: kod < 500, kod }).eq("id", id).eq("obrabotano", false),
      taimautMs,
    );
    return { oshibka: error || null };
  } catch (e) {
    return { oshibka: e };
  }
}

// Разобрать тело и записать. Возвращает { novoe, oshibka } (см. vstavitSobytie). Не бросает.
async function zapisatSobytie(supabase, vhod, parametry) {
  let zapis;
  try {
    zapis = sobratZapis(vhod);
  } catch (e) {
    return { novoe: null, oshibka: e };
  }
  return vstavitSobytie(supabase, zapis, parametry);
}

// delete ... where zapisano < now() - interval '90 days'. Не бросает.
async function ochistitStarye(supabase, { dney = KHRANIT_DNEY, now = Date.now } = {}) {
  try {
    const granitsa = new Date(now() - dney * 24 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from(TABLITSA)
      .delete({ count: "exact" })
      .lt("zapisano", granitsa);
    if (error) return { udaleno: null, oshibka: error };
    return { udaleno: count ?? null, oshibka: null };
  } catch (e) {
    return { udaleno: null, oshibka: e };
  }
}

// Чистка при старте и раз в сутки; таймер не держит процесс (unref). Ошибка — в лог.
function zapustitChistku({ supabase, log = console, now = Date.now } = {}) {
  const odinProkhod = async () => {
    const { udaleno, oshibka } = await ochistitStarye(supabase, { now });
    if (oshibka) {
      log.error(`[${TABLITSA}] чистка не удалась: ${tekstOshibki(oshibka)}`);
    } else if (udaleno) {
      log.log(`[${TABLITSA}] чистка: удалено строк старше ${KHRANIT_DNEY} дн.: ${udaleno}`);
    }
  };
  odinProkhod();
  const taimer = setInterval(odinProkhod, CHISTKA_PERIOD_MS);
  if (typeof taimer.unref === "function") taimer.unref();
  return taimer;
}

module.exports = {
  TABLITSA,
  KHRANIT_DNEY,
  CHISTKA_PERIOD_MS,
  ARENDA_MS,
  ZAPIS_TAIMAUT_MS,
  VID_PO_PUTI,
  klyuchSobytiya,
  razobratTelo,
  vremyaPrinyatiya,
  sobratZapis,
  tekstOshibki,
  vstavitSobytie,
  zvonokZavershen,
  otmetitItog,
  zapisatSobytie,
  ochistitStarye,
  zapustitChistku,
};
