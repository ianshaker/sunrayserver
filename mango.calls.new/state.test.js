"use strict";

// Память звонков (state.js) на подменённом времени: параметр teper вместо часов, таймеров и сети нет.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test mango.calls.new/state.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  zavershennyeZvonki,
  otlozhennyeSessii,
  otmetitZavershenie,
  zvonokUzheZavershen,
  otlozhitSessiyu,
  dostatOtlozhennuyu,
  zabytOtlozhennuyu,
} = require("./state");

const NACHALO = Date.parse("2026-10-17T12:00:00.000Z");
const MINUT = 60 * 1000;
const PAMYAT = 30 * MINUT;

function podgotovit(t) {
  zavershennyeZvonki.clear();
  otlozhennyeSessii.clear();
  t.after(() => {
    zavershennyeZvonki.clear();
    otlozhennyeSessii.clear();
  });
}

test("а) память «звонок закончен»: живёт 30 минут, старше — не считается и выбрасывается при следующей записи", (t) => {
  podgotovit(t);
  otmetitZavershenie("E-1", NACHALO);
  assert.equal(zvonokUzheZavershen("E-1", NACHALO + MINUT), true);
  assert.equal(zvonokUzheZavershen("E-1", NACHALO + PAMYAT), true, "ровно 30 минут — ещё помним");
  assert.equal(zvonokUzheZavershen("E-1", NACHALO + PAMYAT + 1), false, "старше 30 минут — забыли");
  assert.equal(zvonokUzheZavershen("E-2", NACHALO), false, "другой звонок не закончен");
  assert.equal(zavershennyeZvonki.has("E-1"), true, "таймеров нет: пока нет новой записи, старая запись лежит");

  otmetitZavershenie("E-2", NACHALO + 10 * MINUT);
  assert.equal(zavershennyeZvonki.has("E-1"), true, "E-1 ещё не старше 30 минут");
  otmetitZavershenie("E-3", NACHALO + PAMYAT + MINUT);
  assert.deepEqual([...zavershennyeZvonki.keys()], ["E-2", "E-3"], "запись E-1 выброшена при записи E-3, E-2 свежее 30 минут");
});

test("б) отложенная сессия: без обращений живёт 30 минут, старше — не отдаётся и выбрасывается при следующей записи; забыть можно сразу", (t) => {
  podgotovit(t);
  const sessiya1 = { entryId: "E-1", marker: 1 };
  const sessiya2 = { entryId: "E-2", marker: 2 };
  otlozhitSessiyu(sessiya1, NACHALO);
  assert.equal(dostatOtlozhennuyu("E-2", NACHALO), undefined, "чужой entry_id — ничего");
  assert.equal(dostatOtlozhennuyu("E-1", NACHALO + PAMYAT + 1), undefined, "без обращений старше 30 минут — не отдаётся");
  assert.equal(otlozhennyeSessii.has("E-1"), true, "таймеров нет: пока нет новой записи, старая запись лежит");

  otlozhitSessiyu(sessiya2, NACHALO + 10 * MINUT);
  assert.equal(otlozhennyeSessii.has("E-1"), true, "E-1 ещё не старше 30 минут");
  const sessiya3 = { entryId: "E-3" };
  otlozhitSessiyu(sessiya3, NACHALO + PAMYAT + MINUT);
  assert.deepEqual([...otlozhennyeSessii.keys()], ["E-2", "E-3"], "запись E-1 выброшена при записи E-3, E-2 свежее 30 минут");

  // повторная запись того же звонка обновляет и сессию, и время
  const novaya = { entryId: "E-2", marker: 22 };
  otlozhitSessiyu(novaya, NACHALO + PAMYAT + 2 * MINUT);
  assert.equal(dostatOtlozhennuyu("E-2", NACHALO + PAMYAT + 3 * MINUT), novaya, "сессия отдаётся тем же объектом");

  zabytOtlozhennuyu("E-3");
  assert.equal(dostatOtlozhennuyu("E-3", NACHALO + PAMYAT + 3 * MINUT), undefined, "забытая сессия не отдаётся");
  zabytOtlozhennuyu("E-нет"); // забыть то, чего нет, не ошибка
  assert.deepEqual([...otlozhennyeSessii.keys()], ["E-2"]);
});

test("в) пустой и нестроковый ключ игнорируется: память не растёт, поиск по такому ключу ничего не находит", (t) => {
  podgotovit(t);
  for (const plokhoy of ["", undefined, null, 0, 5, {}, ["E-1"], true]) {
    otmetitZavershenie(plokhoy, NACHALO);
    otlozhitSessiyu({ entryId: plokhoy }, NACHALO);
    assert.equal(zvonokUzheZavershen(plokhoy, NACHALO), false);
    assert.equal(dostatOtlozhennuyu(plokhoy, NACHALO), undefined);
  }
  otlozhitSessiyu(undefined, NACHALO);
  otlozhitSessiyu(null, NACHALO);
  otlozhitSessiyu({}, NACHALO); // у сессии нет entryId — откладывать нечего
  assert.equal(zavershennyeZvonki.size, 0);
  assert.equal(otlozhennyeSessii.size, 0);
});

test("г) обращение к отложенной сессии продлевает срок: 30 минут считаются от последнего обращения, а не от записи", (t) => {
  podgotovit(t);
  const sessiya = { entryId: "E-1" };
  otlozhitSessiyu(sessiya, NACHALO);
  assert.equal(dostatOtlozhennuyu("E-1", NACHALO + 20 * MINUT), sessiya, "через 20 минут после записи — отдаётся");
  assert.equal(dostatOtlozhennuyu("E-1", NACHALO + 40 * MINUT), sessiya, "ещё через 20 минут (от записи уже 40) — жива: срок продлён обращением");
  assert.equal(dostatOtlozhennuyu("E-1", NACHALO + 40 * MINUT + PAMYAT), sessiya, "ровно 30 минут от последнего обращения — ещё отдаётся");
  assert.equal(dostatOtlozhennuyu("E-1", NACHALO + 40 * MINUT + 2 * PAMYAT + 1), undefined, "больше 30 минут без обращений — не отдаётся");

  // без обращений срок не продлевается; просроченная запись обращением не оживает
  const bezObrashcheniy = { entryId: "E-2" };
  otlozhitSessiyu(bezObrashcheniy, NACHALO);
  assert.equal(dostatOtlozhennuyu("E-2", NACHALO + 31 * MINUT), undefined, "без обращения через 31 минуту — нет");
  assert.equal(dostatOtlozhennuyu("E-2", NACHALO + 32 * MINUT), undefined, "неудачное обращение запись не оживляет");

  // память «звонок закончен» не меняется: её срок считается только от итога звонка
  otmetitZavershenie("E-3", NACHALO);
  assert.equal(zvonokUzheZavershen("E-3", NACHALO + 20 * MINUT), true);
  assert.equal(zvonokUzheZavershen("E-3", NACHALO + 40 * MINUT), false, "проверка «звонок закончен» срок не продлевает");
});
