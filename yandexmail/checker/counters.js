// ============================================================================
// yandexmail/checker/counters — счётчики работы, вынесены отдельно.
//
// Отдельный модуль нужен, чтобы проход и сторож не тянули друг друга по кругу:
// раньше сторож просил счётчики у прохода, проход — сторожа, и при загрузке
// один из них получал пустышку. Ошибка проявилась сразу на бою строкой
// «getCounters is not a function».
// ============================================================================

const counters = {
  runs: 0,
  seen: 0,
  appeals: 0,
  created: 0,
  contract: 0,
  wouldCreate: 0,
  duplicate: 0,
  blacklisted: 0,
  noPhone: 0,
  errors: 0,
  lastSuccessAt: null,
  lastMailSeenAt: Date.now(),
};

function bump(field, by = 1) {
  if (typeof counters[field] === "number") counters[field] += by;
}

function markSuccess() {
  counters.lastSuccessAt = new Date().toISOString();
}

function markMailSeen() {
  counters.lastMailSeenAt = Date.now();
}

function getCounters() {
  return { ...counters };
}

module.exports = { bump, markSuccess, markMailSeen, getCounters };
