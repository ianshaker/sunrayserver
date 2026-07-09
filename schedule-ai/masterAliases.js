// ============================================================================
// Канонический список мастеров + резолюция имён из свободного текста.
//
// Модель (Gemini) НЕ решает, кто из мастеров имелся в виду — она только
// извлекает из текста то, как менеджер назвал мастера (masters_raw).
// Финальное сопоставление с реальным именем в eventsnew.master делает код —
// это единственная точка, где можно сверить с whitelist и не ошибиться.
//
// Если имя неоднозначно (напр. «Лешка» — диминутив и Лёши, и Алексея, это
// два разных человека), код выбирает вариант по умолчанию, но результат
// резолюции помечается assumed: true — рендер обязан показать это менеджеру.
// ============================================================================

// ИСТОЧНИК ПРАВДЫ — фронтенд CRM, sunray-crm-oasis:
//   src/components/department/finance/wallet/types/walletTypes.ts
//   (МастерКошелек, имяМастера, списокМастеров)
// Бэкенд и фронтенд — разные кодовые базы без общего пакета, поэтому список
// синхронизируется руками. Если на фронте добавили/переименовали мастера —
// обновить и здесь (иначе Gemini не будет знать о новом мастере и уйдёт в clarify).
// Каноничное написание — Title Case, как реально пишет фронт в eventsnew.master
// (не ВЕРХНИЙ РЕГИСТР — это было легаси из старого kalendar.js).
const MASTERS = [
  { key: "anton", canonical: "Антон" },
  { key: "lesha", canonical: "Леша" },
  { key: "roma", canonical: "Рома" },
  { key: "timur", canonical: "Тимур" },
  { key: "semen", canonical: "Семён" },
  { key: "vladimir", canonical: "Владимир" },
  { key: "vyacheslav", canonical: "Вячеслав" },
  { key: "aleksei", canonical: "Алексей" },
  { key: "evgeniy", canonical: "Евгений" },
  { key: "dima", canonical: "Дима" },
  { key: "daniil", canonical: "Даниил" },
  { key: "yglov", canonical: "Углов" },
];

const CANONICAL_MASTERS = MASTERS.map((m) => m.canonical);

// Прямые синонимы/уменьшительные формы → один конкретный мастер (не считаются допущением,
// кроме явно помеченных assumed:true — форм, которые сами по себе не 100% надёжны).
const ALIASES = {
  "леша": { canonical: "Леша", assumed: false },
  "лёша": { canonical: "Леша", assumed: false },
  "алексей": { canonical: "Алексей", assumed: false },
  "антон": { canonical: "Антон", assumed: false },
  "антоха": { canonical: "Антон", assumed: true },
  "рома": { canonical: "Рома", assumed: false },
  "роман": { canonical: "Рома", assumed: true },
  "тимур": { canonical: "Тимур", assumed: false },
  "евгений": { canonical: "Евгений", assumed: false },
  "женя": { canonical: "Евгений", assumed: true },
  "дима": { canonical: "Дима", assumed: false },
  "дмитрий": { canonical: "Дима", assumed: true },
  "вячеслав": { canonical: "Вячеслав", assumed: false },
  "слава": { canonical: "Вячеслав", assumed: true },
  "семен": { canonical: "Семён", assumed: false },
  "семён": { canonical: "Семён", assumed: false },
  "владимир": { canonical: "Владимир", assumed: false },
  "вова": { canonical: "Владимир", assumed: true },
  "володя": { canonical: "Владимир", assumed: true },
  "даниил": { canonical: "Даниил", assumed: false },
  "данил": { canonical: "Даниил", assumed: true },
  "углов": { canonical: "Углов", assumed: false },
};

// Имена, которые реально неоднозначны между двумя разными людьми — здесь
// диминутив «Леха»/«Лешка» одинаково годится и для Леши, и для Алексея.
// Первый элемент — вариант по умолчанию (если менеджер не уточнит).
const AMBIGUOUS = {
  "леха": ["Леша", "Алексей"],
  "лешка": ["Леша", "Алексей"],
  "лёха": ["Леша", "Алексей"],
};

function normalize(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** Расстояние Левенштейна — только для опечаток, не для семантики. */
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
 * Резолюция одного упоминания мастера из текста в каноническое имя.
 * @param {string} rawName — как назвал менеджер (или как извлекла модель), напр. "Лешу", "Лешка", "леха"
 * @returns {{
 *   raw: string,
 *   canonical: string|null,
 *   found: boolean,
 *   assumed: boolean,
 *   alternatives: string[],
 * }}
 */
function resolveMasterName(rawName) {
  const norm = normalize(rawName).replace(/[.,!?]+$/g, "");
  // отбрасываем частые падежные окончания («лешу», «лешей», «антона») — грубая эвристика,
  // без словаря; сначала пробуем как есть, затем срез хвоста.
  const candidates = [norm, norm.replace(/(ой|ый|ого|ому|ому|ем|ей|ем|у|а|ы|и|е|ю)$/u, "")];

  for (const cand of candidates) {
    if (!cand) continue;
    if (ALIASES[cand]) {
      const { canonical, assumed } = ALIASES[cand];
      return { raw: rawName, canonical, found: true, assumed, alternatives: [] };
    }
    if (AMBIGUOUS[cand]) {
      const [primary, ...rest] = AMBIGUOUS[cand];
      return { raw: rawName, canonical: primary, found: true, assumed: true, alternatives: rest };
    }
    const canonicalMatch = CANONICAL_MASTERS.find((m) => normalize(m) === cand);
    if (canonicalMatch) {
      return { raw: rawName, canonical: canonicalMatch, found: true, assumed: false, alternatives: [] };
    }
  }

  // Fuzzy — только опечатки (расстояние ≤ 1), чтобы не подменить одного мастера другим.
  let best = null;
  for (const key of Object.keys(ALIASES)) {
    const dist = levenshtein(norm, key);
    if (dist <= 1 && (!best || dist < best.dist)) {
      best = { dist, key };
    }
  }
  if (best) {
    const { canonical } = ALIASES[best.key];
    return { raw: rawName, canonical, found: true, assumed: true, alternatives: [] };
  }

  return { raw: rawName, canonical: null, found: false, assumed: false, alternatives: [] };
}

/** Текст ростера мастеров для промпта (только канонические имена — без списка алиасов). */
function buildMasterRosterText() {
  return CANONICAL_MASTERS.map((m) => `- ${m}`).join("\n");
}

module.exports = {
  MASTERS,
  CANONICAL_MASTERS,
  resolveMasterName,
  buildMasterRosterText,
};
