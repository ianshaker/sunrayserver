// Топливо замера пишется в общую таблицу toplivo_all с колонкой master; номера id у разных мастеров повторяются.
// Подставной клиент держит таблицу в памяти и честно применяет eq-фильтры: пропал фильтр master — тест краснеет.
// Запуск: node --test --test-concurrency=1 loading-deadlines/fuel.test.js
const test = require("node:test");
const { beforeEach, afterEach } = test;
const assert = require("node:assert/strict");

const { supabase } = require("../lib/supabaseClient");
const dir = require("../lib/mastersDirectory");
const { insertFuelRecord, deleteFuelRecordByAppeal } = require("./fuel");

const REC = { date: "2026-11-05", time: "10:00", address: "ул. Тестовая, 1", place_id: "p1", appeal_id: "A1" };

/** Подставной supabase.from(): общая таблица в памяти + журнал обращений. */
function fakeDb({ rows = [], insertError = null, selectError = null, deleteError = null } = {}) {
  const state = { tables: [], calls: [], rows: rows.map((r) => ({ ...r })) };

  function builder(table) {
    const q = { op: null, row: null, filters: [], order: null, limit: null };
    const run = () => {
      state.calls.push({ table, op: q.op, row: q.row, filters: q.filters.map((f) => [...f]) });
      state.tables.push(table);
      const match = (r) => q.filters.every(([col, val]) => r[col] === val);
      if (q.op === "insert") {
        if (insertError) return { data: null, error: insertError };
        const id = state.rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
        const stored = { id, ...q.row };
        state.rows.push(stored);
        return { data: { id }, error: null };
      }
      if (q.op === "delete") {
        if (deleteError) return { data: null, error: deleteError };
        state.rows = state.rows.filter((r) => !match(r));
        return { data: null, error: null };
      }
      if (selectError) return { data: null, error: selectError };
      let found = state.rows.filter(match);
      if (q.order) found = [...found].sort((a, b) => (q.order.asc ? a.id - b.id : b.id - a.id));
      if (q.limit != null) found = found.slice(0, q.limit);
      return { data: found.map(({ id }) => ({ id })), error: null };
    };
    const api = {
      insert(row) { q.op = "insert"; q.row = row; return api; },
      delete() { q.op = "delete"; return api; },
      select() { if (!q.op) q.op = "select"; return api; },
      eq(col, val) { q.filters.push([col, val]); return api; },
      order(col, o) { q.order = { col, asc: o?.ascending !== false }; return api; },
      limit(n) { q.limit = n; return api; },
      single() { return api; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }

  supabase.from = (table) => builder(table);
  return state;
}

beforeEach(() => {
  dir._setForTests();
});

afterEach(() => {
  delete supabase.from; // вернуть настоящий метод клиента
});

/** Тексты логов fuel.js в тестах не нужны. */
function quiet(t) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "error", () => {});
}

test("insert: строка уходит в toplivo_all с master = ключ мастера, не в toplivo_<ключ>", async (t) => {
  quiet(t);
  const db = fakeDb();
  const data = await insertFuelRecord("Антон", REC);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].table, "toplivo_all");
  assert.equal(db.calls[0].op, "insert");
  assert.equal(db.calls[0].row.master, "anton");
  assert.equal(db.calls[0].row.appeal_id, "A1");
  assert.equal(db.calls[0].row.event_type, "замер");
  assert.equal(db.calls[0].row.status, "не выплачено");
  assert.deepEqual(data, { id: 1 });
  assert.equal(db.rows[0].master, "anton");
});

test("insert: у разных мастеров ключ master свой (Рома — roma, Семён и Семен — semen)", async (t) => {
  quiet(t);
  const db = fakeDb();
  await insertFuelRecord("Рома", REC);
  await insertFuelRecord("Семён", REC);
  await insertFuelRecord("Семен", REC);
  assert.deepEqual(db.rows.map((r) => r.master), ["roma", "semen", "semen"]);
  assert.ok(db.tables.every((x) => x === "toplivo_all"));
});

test("insert: неизвестный мастер — ошибка unknown_fuel_master, в базу не ходили", async (t) => {
  quiet(t);
  const db = fakeDb();
  await assert.rejects(() => insertFuelRecord("Неведомый", REC), /unknown_fuel_master:Неведомый/);
  assert.equal(db.calls.length, 0);
});

test("insert: ошибка базы пробрасывается наверх, как раньше", async (t) => {
  quiet(t);
  const boom = new Error("db down");
  fakeDb({ insertError: boom });
  await assert.rejects(() => insertFuelRecord("Антон", REC), (e) => e === boom);
});

test("delete: поиск и удаление идут с фильтром master; одинаковый id чужого мастера цел", async (t) => {
  quiet(t);
  // у Антона и Ромы по поездке с id=5 (номера повторяются), заявка A1 только у Антона
  const db = fakeDb({
    rows: [
      { master: "anton", id: 5, appeal_id: "A1", event_type: "замер" },
      { master: "roma", id: 5, appeal_id: "B2", event_type: "замер" },
    ],
  });
  const ok = await deleteFuelRecordByAppeal("Антон", "A1");
  assert.equal(ok, true);
  assert.deepEqual(db.rows.map((r) => [r.master, r.id]), [["roma", 5]]);

  const sel = db.calls.find((c) => c.op === "select");
  const del = db.calls.find((c) => c.op === "delete");
  assert.equal(sel.table, "toplivo_all");
  assert.equal(del.table, "toplivo_all");
  assert.deepEqual(sel.filters.find(([c]) => c === "master"), ["master", "anton"]);
  assert.deepEqual(del.filters.find(([c]) => c === "master"), ["master", "anton"]);
  assert.deepEqual(del.filters.find(([c]) => c === "id"), ["id", 5]);
});

test("delete: поиск по appeal_id не цепляет поездку другого мастера с тем же appeal_id", async (t) => {
  quiet(t);
  // заявка A1 была у Ромы (id=9, свежее), потом ушла Антону (id=5): Антон откатывает — удаляется только его строка
  const db = fakeDb({
    rows: [
      { master: "anton", id: 5, appeal_id: "A1", event_type: "замер" },
      { master: "roma", id: 9, appeal_id: "A1", event_type: "замер" },
    ],
  });
  const ok = await deleteFuelRecordByAppeal("Антон", "A1");
  assert.equal(ok, true);
  assert.deepEqual(db.rows.map((r) => [r.master, r.id]), [["roma", 9]]);
});

test("delete: у мастера записи нет — false, чужие строки не тронуты, delete не вызывался", async (t) => {
  quiet(t);
  const db = fakeDb({ rows: [{ master: "roma", id: 5, appeal_id: "A1", event_type: "замер" }] });
  const ok = await deleteFuelRecordByAppeal("Антон", "A1");
  assert.equal(ok, false);
  assert.equal(db.rows.length, 1);
  assert.ok(!db.calls.some((c) => c.op === "delete"));
});

test("delete: ошибка поиска или удаления — false, без исключения; неизвестный мастер и пустой appeal — false без запросов", async (t) => {
  quiet(t);
  let db = fakeDb({ rows: [{ master: "anton", id: 5, appeal_id: "A1", event_type: "замер" }], selectError: new Error("x") });
  assert.equal(await deleteFuelRecordByAppeal("Антон", "A1"), false);
  assert.equal(db.rows.length, 1);

  db = fakeDb({ rows: [{ master: "anton", id: 5, appeal_id: "A1", event_type: "замер" }], deleteError: new Error("x") });
  assert.equal(await deleteFuelRecordByAppeal("Антон", "A1"), false);

  db = fakeDb();
  assert.equal(await deleteFuelRecordByAppeal("Неведомый", "A1"), false);
  assert.equal(await deleteFuelRecordByAppeal("Антон", ""), false);
  assert.equal(db.calls.length, 0);
});
