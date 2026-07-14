// ============================================================================
// Склонения для шапок TG по типу события из CRM (eventsnew.type).
// Без eventType — fallback на «замер» (обратная совместимость со старым CRM).
// ============================================================================

/**
 * @param {string|null|undefined} eventType
 * @returns {{
 *   kind: 'measurement'|'montage'|'reclamation'|'loading',
 *   request: string,
 *   update: string,
 *   cancelTitle: string,
 *   cancelNoun: string,
 * }}
 */
function resolveEventLabels(eventType) {
  const t = String(eventType || "").trim().toLowerCase();

  if (t.includes("монтаж")) {
    return {
      kind: "montage",
      request: "МОНТАЖ",
      update: "МОНТАЖУ",
      cancelTitle: "МОНТАЖ ОТМЕНЁН",
      cancelNoun: "Монтаж",
    };
  }
  if (t.includes("рекламац")) {
    return {
      kind: "reclamation",
      request: "РЕКЛАМАЦИЮ",
      update: "РЕКЛАМАЦИИ",
      cancelTitle: "РЕКЛАМАЦИЯ ОТМЕНЕНА",
      cancelNoun: "Рекламация",
    };
  }
  if (t.includes("погрузк")) {
    return {
      kind: "loading",
      request: "ПОГРУЗКУ",
      update: "ПОГРУЗКЕ",
      cancelTitle: "ПОГРУЗКА ОТМЕНЕНА",
      cancelNoun: "Погрузка",
    };
  }

  return {
    kind: "measurement",
    request: "ЗАМЕР",
    update: "ЗАМЕРУ",
    cancelTitle: "ЗАМЕР ОТМЕНЁН",
    cancelNoun: "Замер",
  };
}

module.exports = { resolveEventLabels };
