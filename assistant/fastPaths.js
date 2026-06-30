// ============================================================================
// Централизованный реестр fast-path правил роутера.
//
// Каждый отдел регистрирует своё fast-path правило через registerFastPath().
// При регистрации автоматически проверяется пересечение ключевых слов
// с уже зарегистрированными правилами — конфликты выводятся в лог при старте.
//
// Правила применяются по убыванию priority. Первое совпадение побеждает.
//
// Пример регистрации:
//   registerFastPath({
//     name: "deadline_reply",
//     intent: "appeal_deadline_manage",
//     priority: 10,
//     keywords: ["перенес", "отказ", "погруз"],
//     detect: (text, replyText) => { ... return { confidence, reason } | null },
//   });
// ============================================================================

const rules = [];

/**
 * Регистрирует fast-path правило роутера.
 * При конфликте ключевых слов с существующими правилами — предупреждение в лог.
 *
 * @param {{
 *   name: string,
 *   intent: string,
 *   priority?: number,
 *   keywords: string[],
 *   detect: (text: string, replyText: string | null) => { confidence: number, reason: string } | null,
 * }} rule
 */
function registerFastPath(rule) {
  if (!rule?.name || !rule?.intent || typeof rule.detect !== "function") {
    throw new Error("[fastPaths] fast-path требует: name, intent, detect");
  }
  if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) {
    throw new Error(`[fastPaths] "${rule.name}": keywords обязательны (нужны для проверки конфликтов)`);
  }

  const newKeywords = rule.keywords.map((k) => k.toLowerCase());

  // Проверка конфликта ключевых слов с уже зарегистрированными правилами.
  for (const existing of rules) {
    const existingKeywords = existing.keywords.map((k) => k.toLowerCase());
    const overlap = newKeywords.filter((k) => existingKeywords.includes(k));
    if (overlap.length > 0) {
      console.warn(
        `[fastPaths] ⚠️  КОНФЛИКТ СЛОВ: "${rule.name}" (intent: ${rule.intent}) ` +
          `пересекается с "${existing.name}" (intent: ${existing.intent}). ` +
          `Общие слова: [${overlap.join(", ")}]. ` +
          `Побеждает правило с бо́льшим priority (сейчас: ${existing.name}=${existing.priority ?? 5}, ${rule.name}=${rule.priority ?? 5}).`,
      );
    }
  }

  rules.push({ ...rule, priority: rule.priority ?? 5 });
  rules.sort((a, b) => b.priority - a.priority);

  console.log(
    `[fastPaths] зарегистрирован: "${rule.name}" → ${rule.intent} ` +
      `(priority: ${rule.priority ?? 5}, keywords: [${rule.keywords.join(", ")}])`,
  );
}

/**
 * Пробует все зарегистрированные fast-path правила в порядке priority.
 * Возвращает первое совпадение или null.
 *
 * @param {string} text
 * @param {string | null} replyText
 * @param {object[]} enabledIntents
 */
function tryFastPaths(text, replyText, enabledIntents) {
  const enabledNames = new Set(enabledIntents.map((i) => i.name));

  for (const rule of rules) {
    if (!enabledNames.has(rule.intent)) continue;

    const match = rule.detect(text, replyText);
    if (!match) continue;

    console.log(
      `[fastPaths] fast-path "${rule.name}" → ${rule.intent} ` +
        `conf=${match.confidence.toFixed(2)} reason="${match.reason}"`,
    );
    return {
      intent: rule.intent,
      confidence: match.confidence,
      reason: match.reason,
    };
  }

  return null;
}

/** Возвращает список всех зарегистрированных правил (для дебага/логов). */
function listFastPaths() {
  return rules.map(({ name, intent, priority, keywords }) => ({
    name,
    intent,
    priority,
    keywords,
  }));
}

module.exports = { registerFastPath, tryFastPaths, listFastPaths };
