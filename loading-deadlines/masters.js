// ============================================================================
// Мастера, которых можно назначить из чата погрузки.
// Нужны: fuel-таблица + Telegram-чат в MASTER_CHAT_IDS.
// ============================================================================

const { MASTER_CHAT_IDS } = require("../info-na-zamer/config");
const { resolveMasterName } = require("../schedule-ai/masterAliases");
const { getFuelTableKey } = require("./fuel");

/** Каноничное имя → ключ MASTER_CHAT_IDS (UPPER). */
const CANONICAL_TO_TG_KEY = {
  Леша: "ЛЕША",
  Антон: "АНТОН",
  Семён: "СЕМЕН",
  Семен: "СЕМЕН",
  Рома: "РОМА",
  Тимур: "ТИМУР",
  Владимир: "ВЛАДИМИР",
  Евгений: "ЕВГЕНИЙ",
  Алексей: "АЛЕКСЕЙ",
  Дима: "ДИМА",
  Даниил: "ДАНИИЛ",
  Углов: "УГЛОВ",
};

function getTelegramMasterKey(canonical) {
  return CANONICAL_TO_TG_KEY[canonical] || null;
}

function isAssignableMaster(canonical) {
  if (!canonical) return false;
  if (!getFuelTableKey(canonical)) return false;
  const tgKey = getTelegramMasterKey(canonical);
  if (!tgKey || MASTER_CHAT_IDS[tgKey] == null) return false;
  return true;
}

/**
 * Резолв + проверка, что мастера можно назначить через бота.
 *
 * @param {string} rawName
 * @returns {{
 *   ok: boolean,
 *   raw: string,
 *   canonical: string|null,
 *   assumed: boolean,
 *   alternatives: string[],
 *   tgKey: string|null,
 *   chatId: number|null,
 *   reason?: string,
 * }}
 */
function resolveAssignableMaster(rawName) {
  const resolved = resolveMasterName(rawName);
  if (!resolved.found || !resolved.canonical) {
    return {
      ok: false,
      raw: rawName,
      canonical: null,
      assumed: false,
      alternatives: [],
      tgKey: null,
      chatId: null,
      reason: `Не понял мастера «${rawName}». Укажите имя из списка: Антон, Рома, Тимур, Семён, Леша, Евгений, Владимир, Алексей, Дима, Даниил, Углов.`,
    };
  }

  const tgKey = getTelegramMasterKey(resolved.canonical);
  const chatId = tgKey != null ? MASTER_CHAT_IDS[tgKey] ?? null : null;

  if (!getFuelTableKey(resolved.canonical)) {
    return {
      ok: false,
      raw: rawName,
      canonical: resolved.canonical,
      assumed: resolved.assumed,
      alternatives: resolved.alternatives || [],
      tgKey,
      chatId,
      reason: `Мастер ${resolved.canonical} не найден в топливном конфиге — назначьте через CRM.`,
    };
  }

  if (chatId == null) {
    return {
      ok: false,
      raw: rawName,
      canonical: resolved.canonical,
      assumed: resolved.assumed,
      alternatives: resolved.alternatives || [],
      tgKey,
      chatId: null,
      reason: `У мастера ${resolved.canonical} нет Telegram-чата в конфиге сервера — назначьте через CRM.`,
    };
  }

  return {
    ok: true,
    raw: rawName,
    canonical: resolved.canonical,
    assumed: resolved.assumed,
    alternatives: resolved.alternatives || [],
    tgKey,
    chatId,
  };
}

/**
 * start HH:mm + 60 минут → end HH:mm.
 * Если слот уходит за полночь — null (назначайте раньше).
 *
 * @param {string} startTime
 * @returns {string|null}
 */
function addOneHour(startTime) {
  const m = String(startTime || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  const total = h * 60 + min + 60;
  if (total >= 24 * 60) return null;
  const eh = Math.floor(total / 60);
  const em = total % 60;
  return `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
}

/**
 * Нормализует start time к HH:mm.
 * @param {string} raw
 */
function normalizeStartTime(raw) {
  const s = String(raw || "").trim();
  // «14», «14:00», «14.00», «2 часа дня» уже должны прийти как HH:mm от модели
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

module.exports = {
  CANONICAL_TO_TG_KEY,
  getTelegramMasterKey,
  isAssignableMaster,
  resolveAssignableMaster,
  addOneHour,
  normalizeStartTime,
};
