"use strict";

// Подделки для тестов журнала Mango и маршрутов прокси (zhurnalSobytiy.test.js, marshrutyProksi.test.js).
// В боевом коде не используются. Сети и базы нет.

// Подмена клиента Supabase: пишет цепочку вызовов (from → upsert → select ...) и отвечает тем,
// что вернёт otvet(zapros). Ответ — { data, error, count } или Promise; throw/reject = отказ запроса.
function podmenaSupabase(otvet = () => ({ data: [{ id: 1 }], error: null })) {
  const zaprosy = [];
  return {
    zaprosy,
    from(tablitsa) {
      const zapros = { tablitsa, shagi: [] };
      zaprosy.push(zapros);
      const cep = new Proxy(
        {},
        {
          get(_, imya) {
            if (imya === "then") {
              return (resolve, reject) => {
                try {
                  Promise.resolve(otvet(zapros)).then(resolve, reject);
                } catch (e) {
                  reject(e);
                }
              };
            }
            return (...args) => {
              zapros.shagi.push([imya, ...args]);
              return cep;
            };
          },
        },
      );
      return cep;
    },
  };
}

// Аргументы первого вызова метода в цепочке запроса: shag(zapros, "upsert") → [строка, параметры].
function shag(zapros, imya) {
  return zapros.shagi.find((s) => s[0] === imya)?.slice(1);
}

// Подмена журнала: собирает записи всех уровней.
function podmenaLog() {
  const zapisi = [];
  const log = {};
  for (const uroven of ["log", "warn", "error"]) {
    log[uroven] = (...args) => zapisi.push({ uroven, tekst: args.join(" ") });
  }
  return { log, zapisi };
}

function peredacha() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Память вместо таблицы mango_events для podmenaSupabase(pamyat.otvet): понимает ровно те запросы, что шлёт код журнала:
// upsert с ignoreDuplicates (ключ уже есть → пустой список), select(...) и update(...) с фильтрами eq / is.
// Обновление с .select(...) отвечает списком изменённых строк, без него — пустым ответом.
// pamyat.stroki — строки как в таблице (id, obrabotano=false, kod=null и vzyato=null по умолчанию, как в миграциях).
function pamyatMangoEvents() {
  const stroki = [];
  let posledniyId = 0;
  const filtry = (zapros) =>
    zapros.shagi
      .filter(([imya]) => imya === "eq" || imya === "is")
      .map(([imya, pole, znachenie]) => [pole, imya === "is" ? null : znachenie]);
  const podkhodyat = (stroka, spisok) => spisok.every(([pole, znachenie]) => (stroka[pole] ?? null) === znachenie);
  const otvet = (zapros) => {
    if (zapros.tablitsa !== "mango_events") return { data: [], error: null };
    const upsert = shag(zapros, "upsert");
    const update = shag(zapros, "update");
    const vyborka = shag(zapros, "select");
    if (upsert) {
      if (stroki.some((s) => s.klyuch === upsert[0].klyuch)) return { data: [], error: null };
      posledniyId += 1;
      stroki.push({ id: posledniyId, obrabotano: false, kod: null, vzyato: null, ...upsert[0] });
      return { data: [{ id: posledniyId }], error: null };
    }
    const nashli = stroki.filter((s) => podkhodyat(s, filtry(zapros)));
    if (update) {
      for (const stroka of nashli) Object.assign(stroka, update[0]);
      return { data: vyborka ? nashli.map((s) => ({ id: s.id })) : null, error: null };
    }
    if (vyborka) {
      const kolonki = vyborka[0].split(",");
      return { data: nashli.map((s) => Object.fromEntries(kolonki.map((k) => [k, s[k] ?? null]))), error: null };
    }
    return { data: [], error: null };
  };
  return { stroki, otvet };
}

module.exports = { podmenaSupabase, shag, podmenaLog, peredacha, pamyatMangoEvents };
