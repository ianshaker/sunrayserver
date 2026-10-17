"use strict";

// Сторона Render договора «прокси Mango ↔ Render» (З5):
//  - журнал событий вокруг обработчика /events/call и /events/summary: preHandler пишет событие в mango_events
//    (после замка, который стоит на onRequest), onSend отмечает итог ответа обработчика (obrabotano, kod);
//  - маршруты прокси: POST /internal/mango-event, POST /internal/recording-id, GET /internal/recording-queue,
//    POST /internal/recording-attempt. Секрет прокси обязателен всегда (замок tolkoSekret), запасного пути по адресу нет.
// Прокси больше не ходит в Supabase сам: его запросы повторены здесь service_role-клиентом сервера
// (источник: mango-proxy/src/services/supabase.js, handlers/recording.js, workers/recordingRetry.js).
// Журнал и защита от повторов работают сразу после выкладки и от MANGO_PROXY_SECRET не зависят.
// Подключение в server.js после замков:
//   const zhurnalSobytiy = require("./mango.calls.new/marshrutyProksi").registerMarshrutyProksi(fastify, zamokSekretProksi);
//   у /events/call и /events/summary: { bodyLimit, onRequest: checkSelectelIP, preHandler: zhurnalSobytiy.preHandler, onSend: zhurnalSobytiy.onSend }.
// Итог пишет onSend, а не onResponse: onResponse Fastify не зовёт, если прокси оборвал соединение по таймауту,
// пока обработчик ещё работал, и обработанное событие осталось бы obrabotano=false и ушло бы в обработку второй раз.

const {
  sobratZapis,
  vremyaPrinyatiya,
  tekstOshibki,
  vstavitSobytie,
  zvonokZavershen,
  otmetitItog,
  zapustitChistku,
} = require("./zhurnalSobytiy");

const TABLITSA_ZVONKOV = "mango_calls";
// call-событие из очереди прокси старше этого возраста (по x-mango-prinyato) только пишем в журнал:
// живые карточки Telegram по нему уже устарели.
const POZDNIY_POVTOR_MS = 10 * 60 * 1000;
// Что принимает /internal/mango-event как зеркало записей (договор).
const PUTI_ZERKALA = new Set(["/events/recording", "/events/record/added"]);
// Тела маленькие; тело разбирается до замка, поэтому потолок ниже общего (55 МБ под mp3).
const BODY_LIMIT_BYTES = 1024 * 1024;

// recordingRetry.js:7-8 — размер пачки и «не трогаем свежие строки, пока идёт inline-retry»
const OCHERED_LIMIT_PO_UMOLCHANIYU = 5;
const OCHERED_LIMIT_MAKS = 50;
const OCHERED_MIN_VOZRAST_MS = 45 * 1000;
// recordingRetry.js:20 — downloading: залипшие от старого кода / обрыв mid-flight
const OCHERED_STATUSY = ["pending", "failed", "downloading"];
// Какие статусы пишет прокси: failed (recording.js:29), pending (supabase.js:77 через markPendingIfNotReady)
const STATUSY_POPYTKI = new Set(["pending", "failed"]);

function putZaprosa(url) {
  return String(url || "").split("?")[0];
}

function zagolovkiSobytiya(zagolovki = {}) {
  return {
    prinyato: zagolovki["x-mango-prinyato"],
    podpis: zagolovki["x-mango-podpis"],
    povtor: zagolovki["x-mango-povtor"] === "1",
  };
}

// entry_id / recording_id из тела: строка или число → строка; пусто → null; другое → undefined (ошибка тела).
function idIzTela(znachenie) {
  if (znachenie === undefined || znachenie === null || znachenie === "") return null;
  if (typeof znachenie === "string") return znachenie;
  if (typeof znachenie === "number" && Number.isFinite(znachenie)) return String(znachenie);
  return undefined;
}

function limitOcheredi(znachenie) {
  const n = Number.parseInt(znachenie, 10);
  if (!Number.isInteger(n) || n < 1) return OCHERED_LIMIT_PO_UMOLCHANIYU;
  return Math.min(n, OCHERED_LIMIT_MAKS);
}

// PostgREST: значение в двойных кавычках (внутри or=(...) запятые и скобки в значении иначе ломают разбор).
function vKavychkakh(znachenie) {
  return `"${String(znachenie).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Нарушение уникальности (entry_id или recording_id в mango_calls).
function konfliktUnikalnosti(oshibka) {
  return Boolean(oshibka) && oshibka.code === "23505";
}

// mango-proxy supabase.js:10-41 updateCallRow: обновить строку звонка по entry_id, а если её нет — создать заготовку
// { entry_id, client_phone: '', client_phone_digits: '', ...поля }. uslovie(update) добавляет фильтры к update
// (например «ещё не готово»): строка, не прошедшая условие, обновлена не будет, а заготовка упрётся в уникальный
// entry_id (23505) — вызывающий понимает это как «строка есть, но трогать её нельзя».
// Не бросает: { inserted, updated, error } (error — объект ошибки или null).
async function obnovitStrokuZvonka(supabase, entryId, polya, { uslovie } = {}) {
  try {
    let obnovlenie = supabase.from(TABLITSA_ZVONKOV).update(polya).eq("entry_id", entryId);
    if (uslovie) obnovlenie = uslovie(obnovlenie);
    const { data, error } = await obnovlenie.select("id");
    if (error) return { inserted: false, updated: false, error };
    if (Array.isArray(data) && data.length === 0) {
      const { error: oshibkaVstavki } = await supabase
        .from(TABLITSA_ZVONKOV)
        .insert({ entry_id: entryId, client_phone: "", client_phone_digits: "", ...polya });
      if (oshibkaVstavki) return { inserted: false, updated: false, error: oshibkaVstavki };
      return { inserted: true, updated: false, error: null };
    }
    return { inserted: false, updated: true, error: null };
  } catch (e) {
    return { inserted: false, updated: false, error: e };
  }
}

// mango-proxy workers/recordingRetry.js:12-35 fetchPendingRecordings: строки с recording_id, без storage_path,
// со статусом pending/failed/downloading, не младше 45 с, старые первыми.
async function ocherediZapisey(supabase, { limit, now = Date.now }) {
  const minUpdated = new Date(now() - OCHERED_MIN_VOZRAST_MS).toISOString();
  return supabase
    .from(TABLITSA_ZVONKOV)
    .select("entry_id,recording_id,recording_status,updated_at")
    .not("recording_id", "is", null)
    .is("storage_path", null)
    .in("recording_status", OCHERED_STATUSY)
    .lt("updated_at", minUpdated)
    .order("updated_at", { ascending: true })
    .limit(limit);
}

// Журнал вокруг обработчика /events/call и /events/summary. Никогда не бросает.
// preHandler (после замка) записывает событие в mango_events до обработчика и берёт его в аренду на 60 с:
//  - ключ уже есть и obrabotano=true → 200 {ok:true,duplicate:true}, обработчик не зовётся;
//  - ключ есть, obrabotano=false, а аренда моложе 60 с (событие в работе) → 503 {error:"zanyato"}, прокси повторит позже;
//  - ключ есть, obrabotano=false, аренда старше 60 с (прошлый раз 5xx или упали посередине) → берём заново, обработчик зовётся;
//  - запись упала (в т. ч. таблицы ещё нет) → лог и дальше в обработчик: звонок важнее журнала;
//  - повтор call из очереди прокси (x-mango-povtor: 1), который живой карточке уже не нужен — старше 10 мин или звонок
//    по журналу уже закончился (есть summary или Disconnected по тому же entry_id): только запись, 200, без обработчика.
//    Исключение — Appeared@abonent: обработчик зовётся с request.mangoBezTelegram, он создаёт заявку новому клиенту
//    без карточки Telegram и без сессий в памяти;
//  - summary обрабатывается всегда (кроме дубля).
// onSend (route-level) после ответа записывает итог: obrabotano = (код < 500), kod = код — по id строки этого запроса.
function sozdatZhurnalMarshrutov({ supabase, log = console, now = Date.now }) {
  async function preHandler(req, reply) {
    let put = "";
    try {
      put = putZaprosa(req.url);
      const zapis = sobratZapis({ path: put, telo: req.body, ...zagolovkiSobytiya(req.headers) });
      const prinyatoMs = vremyaPrinyatiya(zapis.prinyato);
      const povtorCall = zapis.vid === "call" && zapis.povtor;
      const pozdniyPovtor = povtorCall && prinyatoMs !== null && now() - prinyatoMs > POZDNIY_POVTOR_MS;
      const metka = `${put} entry=${zapis.entry_id || "—"}`;

      // Повтор call по законченному звонку смотрим до записи: сбой чтения ничего не оставляет в аренде.
      let zvonokZakonchen = false;
      if (povtorCall && !pozdniyPovtor && zapis.entry_id) {
        const proverka = await zvonokZavershen(supabase, zapis.entry_id, zapis.klyuch);
        if (proverka.oshibka) {
          log.error(`[mango_events] ${metka}: не проверили, закончен ли звонок (${tekstOshibki(proverka.oshibka)}), вернули 503, прокси досылает`);
          return reply.code(503).send({ ok: false, error: "db_error" });
        }
        zvonokZakonchen = proverka.zavershen === true;
      }
      const ustarel = pozdniyPovtor || zvonokZakonchen;

      const { novoe, oshibka, id, obrabotano, zanyato } = await vstavitSobytie(supabase, zapis, { teper: now });

      if (oshibka) {
        // Устаревшему повтору обработчик не нужен, а записать не вышло: пусть прокси оставит его в очереди.
        log.error(
          `[mango_events] ${metka}: запись не удалась (${tekstOshibki(oshibka)}), ` +
            (ustarel ? "устаревший повтор — вернули 503, прокси досылает" : "обрабатываем дальше"),
        );
        if (ustarel) return reply.code(503).send({ ok: false, error: "db_error" });
        return undefined;
      }
      if (obrabotano) return reply.code(200).send({ ok: true, duplicate: true });
      // Событие в работе у другого захода (или аренду только что перехватили): не обрабатываем и итог не пишем.
      if (zanyato) return reply.code(503).send({ ok: false, error: "zanyato" });

      // Итог этого ответа onSend запишет в ту же строку (и у устаревшего повтора: 200 → obrabotano=true, kod=200).
      if (id !== undefined && id !== null) req.mangoZhurnalId = id;
      if (ustarel) {
        if (zapis.sobytie !== "Appeared@abonent") return reply.code(200).send({ ok: true, stale: true });
        // Новому клиенту заявка нужна и по устаревшему Appeared; карточка и сессии звонка — нет.
        req.mangoBezTelegram = true;
        return undefined;
      }
      if (!novoe) {
        log.warn(`[mango_events] ${metka}: прошлый раз не обработано, обрабатываем снова`);
      }
    } catch (e) {
      log.error(`[mango_events] ${put || "?"}: сбой журнала, обрабатываем дальше: ${tekstOshibki(e)}`);
    }
    return undefined;
  }

  async function onSend(req, reply, payload) {
    try {
      const id = req.mangoZhurnalId;
      if (id !== undefined && id !== null) {
        const kod = reply.statusCode;
        // Не ждём базу: ответ прокси не должен зависеть от журнала.
        otmetitItog(supabase, id, kod)
          .then(({ oshibka }) => {
            if (oshibka) log.error(`[mango_events] id=${id}: итог ответа ${kod} не записан (${tekstOshibki(oshibka)})`);
          })
          .catch(() => {});
      }
    } catch (e) {
      log.error(`[mango_events] итог ответа не записан: ${tekstOshibki(e)}`);
    }
    return payload;
  }

  return { preHandler, onSend };
}

// Регистрирует /internal/* прокси за замком zamokSekret (секрет обязателен всегда), запускает чистку журнала
// (старт + раз в сутки) и возвращает { preHandler, onSend } журнала для /events/call и /events/summary.
// opts: supabase (по умолчанию серверный клиент lib/supabaseClient), log, now, chistka:false — не запускать чистку,
// servisnyyKlyuch — есть ли ключ service_role (по умолчанию берётся у клиента сервера; для чужого клиента строка не пишется).
function registerMarshrutyProksi(fastify, zamokSekret, opts = {}) {
  const klientServera = opts.supabase ? null : require("../lib/supabaseClient");
  const supabase = opts.supabase || klientServera.supabase;
  const log = opts.log || console;
  const now = opts.now || Date.now;
  const parametry = { preHandler: zamokSekret, bodyLimit: BODY_LIMIT_BYTES };

  const servisnyyKlyuch = opts.servisnyyKlyuch !== undefined ? opts.servisnyyKlyuch : klientServera?.USING_SERVICE_ROLE;
  if (typeof servisnyyKlyuch === "boolean") {
    log.log(`журнал Mango: ключ service_role ${servisnyyKlyuch ? "есть" : "нет"}`);
  }

  // Зеркало сырых событий записи: только журнал. Не записали — не 2xx, чтобы прокси оставил файл в очереди.
  fastify.post("/internal/mango-event", parametry, async (req, reply) => {
    const { path, body } = req.body || {};
    const telo = body && typeof body === "object" && !Array.isArray(body);
    if (!PUTI_ZERKALA.has(path) || !telo) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    // Обработчика у зеркала нет: «только запись» — сразу обработано.
    const zapis = { ...sobratZapis({ path, telo: body, ...zagolovkiSobytiya(req.headers) }), obrabotano: true, kod: 200 };
    const { novoe, oshibka } = await vstavitSobytie(supabase, zapis, { teper: now });
    if (oshibka) {
      log.error(`[mango_events] ${path} entry=${zapis.entry_id || "—"}: запись не удалась (${tekstOshibki(oshibka)})`);
      return reply.code(500).send({ ok: false, error: "db_error" });
    }
    return reply.send({ ok: true, duplicate: !novoe });
  });

  // recording.js:24 и recordingPipeline.js:33: { recording_id } в строку звонка; строки нет — заготовка (не 404).
  // Пустой recording_id — 400 (прокси такое не шлёт). Заменить можно только пустой номер записи или тот же самый:
  // другой непустой, как и номер записи, уже занятый другим звонком, — 409 (прокси положит в otkazano, не повторяет).
  fastify.post("/internal/recording-id", parametry, async (req, reply) => {
    const entryId = idIzTela(req.body?.entry_id);
    const recordingId = idIzTela(req.body?.recording_id);
    if (!entryId || !recordingId) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const itog = await obnovitStrokuZvonka(
      supabase,
      entryId,
      { recording_id: recordingId },
      { uslovie: (obnovlenie) => obnovlenie.or(`recording_id.is.null,recording_id.eq.${vKavychkakh(recordingId)}`) },
    );
    if (konfliktUnikalnosti(itog.error)) {
      return reply.code(409).send({ ok: false, error: "recording_id_conflict" });
    }
    if (itog.error) {
      log.error(`[proksi] recording-id entry=${entryId}: ${tekstOshibki(itog.error)}`);
      return reply.code(500).send({ ok: false, error: "db_error" });
    }
    return reply.send({ ok: true, inserted: itog.inserted });
  });

  // Остальное, что прокси писал в mango_calls: failed (recording.js:29) и pending (markPendingIfNotReady). Одним update
  // с условием: строку с готовым файлом (storage_path) или статусом ready не трогаем. Строки нет — заготовка, как у прокси;
  // строка есть, но под защитой, — заготовка упирается в уникальный entry_id и это не ошибка (skipped).
  fastify.post("/internal/recording-attempt", parametry, async (req, reply) => {
    const entryId = idIzTela(req.body?.entry_id);
    const status = req.body?.recording_status;
    if (!entryId || !STATUSY_POPYTKI.has(status)) {
      return reply.code(400).send({ ok: false, error: "bad_request" });
    }
    const itog = await obnovitStrokuZvonka(
      supabase,
      entryId,
      { recording_status: status },
      { uslovie: (obnovlenie) => obnovlenie.is("storage_path", null).neq("recording_status", "ready") },
    );
    if (konfliktUnikalnosti(itog.error)) {
      return reply.send({ ok: true, updated: false, inserted: false, skipped: true });
    }
    if (itog.error) {
      log.error(`[proksi] recording-attempt entry=${entryId}: ${tekstOshibki(itog.error)}`);
      return reply.code(500).send({ ok: false, error: "db_error" });
    }
    return reply.send({ ok: true, updated: itog.updated, inserted: itog.inserted, skipped: false });
  });

  // Очередь повторов записи: тот же запрос, что делал воркер прокси.
  fastify.get("/internal/recording-queue", { preHandler: zamokSekret }, async (req, reply) => {
    try {
      const { data, error } = await ocherediZapisey(supabase, { limit: limitOcheredi(req.query?.limit), now });
      if (error) {
        log.error(`[proksi] recording-queue: ${tekstOshibki(error)}`);
        return reply.code(500).send({ ok: false, error: "db_error" });
      }
      return reply.send(Array.isArray(data) ? data : []);
    } catch (e) {
      log.error(`[proksi] recording-queue: ${tekstOshibki(e)}`);
      return reply.code(500).send({ ok: false, error: "db_error" });
    }
  });

  if (opts.chistka !== false) zapustitChistku({ supabase, log, now });

  return sozdatZhurnalMarshrutov({ supabase, log, now });
}

module.exports = {
  registerMarshrutyProksi,
  sozdatZhurnalMarshrutov,
  obnovitStrokuZvonka,
  ocherediZapisey,
  POZDNIY_POVTOR_MS,
};
