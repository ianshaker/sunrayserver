// ============================================================================
// Реестр интентов — каждый отдел регистрирует свой обработчик.
// ============================================================================

const intents = new Map();

/**
 * @param {{
 *   name: string,
 *   permission: string,
 *   title?: string,
 *   description: string,
 *   examples?: string[],
 *   handle: (ctx: object) => Promise<void>,
 * }} def
 */
function registerIntent(def) {
  if (!def?.name || !def?.permission || typeof def.handle !== "function") {
    throw new Error("[assistant/registry] intent требует name, permission, handle");
  }
  intents.set(def.name, def);
  console.log(`[assistant/registry] интент «${def.name}» (${def.permission})`);
}

function getIntent(name) {
  return intents.get(name) ?? null;
}

function getAllIntents() {
  return [...intents.values()];
}

/** Интенты, разрешённые для чата по его permissions. */
function getEnabledIntents(permissions) {
  const allowed = new Set(Array.isArray(permissions) ? permissions : []);
  return getAllIntents().filter((intent) => allowed.has(intent.permission));
}

module.exports = {
  registerIntent,
  getIntent,
  getAllIntents,
  getEnabledIntents,
};
