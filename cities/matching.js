// ============================================================================
// Сравнение названий городов: написание без ё, падежи, мелкие опечатки.
//
// Раньше жило в schedule-ai/cityAliases.js. Логика не изменилась — изменился
// источник списка: теперь он приходит из базы (см. store.js), а не лежит рядом
// в файле. Точно такие же правила работают в CRM
// (sunray-crm-oasis/src/utils/cityMatching.ts) — там они нужны до записи города
// в базу. Меняешь правило здесь — поменяй и там.
// ============================================================================

function normalize(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^г\.?\s+/, "") // «г. Можайск» → «можайск»
    .replace(/^(в|во|по|на|из|от|до)\s+/, "") // «в Можайске» → «можайске»
    .replace(/ё/g, "е")
    .replace(/[ьъ]/g, "");
}

/** Расстояние Левенштейна — только для опечаток и падежей, не для смысла. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Резолюция города из свободного текста в точное название из справочника.
 * Порог правок растёт с длиной названия, чтобы не слить разные короткие города.
 * @param {string[]} names — названия из справочника
 * @param {string} rawName — как назвал менеджер
 * @returns {{ raw: string, canonical: string|null, found: boolean }}
 */
function resolveCityName(names, rawName) {
  const norm = normalize(rawName).replace(/[.,!?]+$/g, "");
  if (!norm) return { raw: rawName, canonical: null, found: false };

  const exact = names.find((name) => normalize(name) === norm);
  if (exact) return { raw: rawName, canonical: exact, found: true };

  let best = null;
  for (const name of names) {
    const cityNorm = normalize(name);
    const maxDist = cityNorm.length > 6 ? 2 : 1;
    const dist = levenshtein(norm, cityNorm);
    if (dist <= maxDist && (!best || dist < best.dist)) {
      best = { dist, name };
    }
  }
  if (best) return { raw: rawName, canonical: best.name, found: true };

  return { raw: rawName, canonical: null, found: false };
}

module.exports = { normalize, levenshtein, resolveCityName };
