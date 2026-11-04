// ============================================================================
// Список мастеров для сервера: чат Telegram, ключ топлива, имя — одним местом.
//
// Источник — таблица public.masters. Снимок хранится в памяти и обновляется
// раз в минуту; если база не отвечает или вернула пусто, работает запасной
// список (те же 12 мастеров и 11 чатов, что были зашиты в коде раньше).
// Читают снимок синхронные функции; асинхронные места (маршруты, бот) перед
// этим зовут ensureFresh() — он перечитывает таблицу, если снимок старше минуты.
// ============================================================================

const { MASTER_CHAT_IDS } = require("../info-na-zamer/config");

const CACHE_MS = 60 * 1000;
const MISS_GAP_MS = 10 * 1000;

/** Запас на сбой базы: ключ (латиницей, суффикс таблиц), имя как в CRM, ключ для Telegram. */
const FALLBACK_MASTERS = [
  { key: "anton", name: "Антон", tgKey: "АНТОН" },
  { key: "lesha", name: "Леша", tgKey: "ЛЕША" },
  { key: "roma", name: "Рома", tgKey: "РОМА" },
  { key: "timur", name: "Тимур", tgKey: "ТИМУР" },
  { key: "semen", name: "Семён", tgKey: "СЕМЕН" },
  { key: "vladimir", name: "Владимир", tgKey: "ВЛАДИМИР" },
  { key: "vyacheslav", name: "Вячеслав", tgKey: null },
  { key: "aleksei", name: "Алексей", tgKey: "АЛЕКСЕЙ" },
  { key: "evgeniy", name: "Евгений", tgKey: "ЕВГЕНИЙ" },
  { key: "dima", name: "Дима", tgKey: "ДИМА" },
  { key: "daniil", name: "Даниил", tgKey: "ДАНИИЛ" },
  { key: "yglov", name: "Углов", tgKey: "УГЛОВ" },
].map((m) => ({
  ...m,
  chatId: m.tgKey != null ? MASTER_CHAT_IDS[m.tgKey] ?? null : null,
  active: true,
}));

/** Имя без регистра и без «ё» — «Семён» и «СЕМЕН» это один мастер. */
function normName(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

function normTgKey(raw) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/Ё/g, "Е");
}

/** При одинаковом имени без «ё» и регистра побеждает активный и с чатом, при равенстве — первый по порядку. */
function setPreferred(map, k, m) {
  const cur = map.get(k);
  const score = (x) => (x.active ? 2 : 0) + (x.chatId != null ? 1 : 0);
  if (!cur || score(m) > score(cur)) map.set(k, m);
}

function buildSnapshot(masters, source) {
  const byKey = new Map();
  const byName = new Map();
  const byTgKey = new Map();
  for (const m of masters) {
    byKey.set(m.key, m);
    setPreferred(byName, normName(m.name), m);
    if (m.tgKey) setPreferred(byTgKey, normTgKey(m.tgKey), m);
  }
  return { masters, byKey, byName, byTgKey, source };
}

const state = {
  snapshot: buildSnapshot(FALLBACK_MASTERS, "fallback"),
  loadedAt: 0,
  lastAttemptAt: 0,
  inFlight: null,
  timer: null,
  disabled: false,
  autoStart: true,
  loader: null,
};

async function defaultLoader() {
  const { supabase } = require("./supabaseClient");
  return supabase
    .from("masters")
    .select("key,name,is_active,tg_chat_id,tg_key,sort_order")
    .order("sort_order", { ascending: true });
}

function rowsToMasters(rows) {
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    tgKey: r.tg_key || null,
    chatId: r.tg_chat_id != null ? Number(r.tg_chat_id) : null,
    active: r.is_active !== false,
  }));
}

async function doRefresh() {
  state.lastAttemptAt = Date.now();
  try {
    const { data, error } = await (state.loader || defaultLoader)();
    if (error) {
      console.error("[mastersDirectory] ошибка чтения masters:", error.message || error);
      return false;
    }
    if (!Array.isArray(data) || data.length === 0) {
      console.error("[mastersDirectory] masters вернула пусто — остаётся прежний список");
      return false;
    }
    state.snapshot = buildSnapshot(rowsToMasters(data), "db");
    state.loadedAt = Date.now();
    return true;
  } catch (e) {
    console.error("[mastersDirectory] сбой чтения masters:", e.message);
    return false;
  }
}

/** Перечитывает таблицу; параллельные вызовы делят один запрос. */
function refresh() {
  if (!state.inFlight) {
    state.inFlight = doRefresh().finally(() => {
      state.inFlight = null;
    });
  }
  return state.inFlight;
}

/** Снимок моложе минуты — ничего не делает, иначе перечитывает. */
async function ensureFresh() {
  if (state.disabled) return;
  if (Date.now() - state.lastAttemptAt < CACHE_MS && state.loadedAt) return;
  if (Date.now() - state.lastAttemptAt < MISS_GAP_MS) return;
  await refresh();
}

/** Не нашли мастера — возможно, его только что завели: перечитываем не чаще раза в 10 секунд. */
async function refreshOnMiss() {
  if (state.disabled) return;
  if (Date.now() - state.lastAttemptAt < MISS_GAP_MS) return;
  await refresh();
}

function startAutoRefresh() {
  if (state.timer || state.disabled || !state.autoStart) return;
  state.timer = setInterval(() => {
    refresh();
  }, CACHE_MS);
  if (typeof state.timer.unref === "function") state.timer.unref();
  if (Date.now() - state.lastAttemptAt > MISS_GAP_MS) refresh();
}

function snap() {
  if (!state.timer) startAutoRefresh();
  return state.snapshot;
}

/** Мастер по имени («Семён», «семен», «СЕМЁН»). */
function findByName(name) {
  return snap().byName.get(normName(name)) || null;
}

/** Мастер по ключу для Telegram или по имени (как приходит из CRM: «СЕМЕН»). */
function findByTgKeyOrName(raw) {
  const s = snap();
  return s.byTgKey.get(normTgKey(raw)) || s.byName.get(normName(raw)) || null;
}

/** Ключ топлива (суффикс таблиц toplivo_*): есть и у ушедших — по ним остались записи. */
function getFuelKey(name) {
  const m = findByName(name);
  return m ? m.key : null;
}

/** Чат мастера по имени из CRM; не нашли — перечитываем таблицу один раз и ищем снова. */
async function getChatId(raw) {
  await ensureFresh();
  let m = findByTgKeyOrName(raw);
  if (!m || m.chatId == null) {
    await refreshOnMiss();
    m = findByTgKeyOrName(raw);
  }
  return m && m.chatId != null ? m.chatId : null;
}

/** Каноничные имена активных мастеров — для подсказки модели и разбора имён. */
function getCanonicalNames() {
  const seen = new Set();
  return snap()
    .masters.filter((m) => m.active)
    .map((m) => m.name)
    .filter((n) => (seen.has(normName(n)) ? false : (seen.add(normName(n)), true)));
}

/** Имена, которых можно назначить через бота: активные, с чатом. */
function getAssignableNames() {
  return snap()
    .masters.filter((m) => m.active && m.chatId != null)
    .map((m) => m.name);
}

function getSource() {
  return snap().source;
}

/**
 * Только для тестов: подменить снимок и загрузчик; таймера нет.
 * refresh: true — оставить перечитку включённой (ensureFresh, refreshOnMiss работают через loader).
 */
function _setForTests({ masters, loader, refresh: allowRefresh = false } = {}) {
  state.disabled = !allowRefresh;
  state.autoStart = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.loader = loader || null;
  state.inFlight = null;
  state.lastAttemptAt = 0;
  state.loadedAt = 0;
  state.snapshot = buildSnapshot(masters || FALLBACK_MASTERS, masters ? "test" : "fallback");
}

module.exports = {
  FALLBACK_MASTERS,
  normName,
  normTgKey,
  refresh,
  ensureFresh,
  refreshOnMiss,
  findByName,
  findByTgKeyOrName,
  getFuelKey,
  getChatId,
  getCanonicalNames,
  getAssignableNames,
  getSource,
  _setForTests,
};
