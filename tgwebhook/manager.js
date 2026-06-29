// Оркестрация вебхука: активировать / удалить / обновить статус.
// Сохраняет намерение в Supabase, чтобы self-heal знал желаемое состояние.

const api = require("./api");
const {
  WEBHOOK_URL,
  WEBHOOK_SECRET,
  ALLOWED_UPDATES,
  MAX_CONNECTIONS,
} = require("./config");
const { writeState } = require("./store");

async function activateWebhook(opts) {
  const { dropPending = false } = opts || {};

  await api.setWebhook({
    url: WEBHOOK_URL,
    secret: WEBHOOK_SECRET,
    allowedUpdates: ALLOWED_UPDATES,
    dropPending,
    maxConnections: MAX_CONNECTIONS,
  });

  const info = await api.getWebhookInfo();
  await writeState({
    active: true,
    url: WEBHOOK_URL,
    secret_set: true,
    last_info: info,
  });
  return info;
}

async function removeWebhook(opts) {
  const { dropPending = true } = opts || {};

  await api.deleteWebhook({ dropPending });

  const info = await api.getWebhookInfo();
  await writeState({
    active: false,
    url: "",
    secret_set: false,
    last_info: info,
  });
  return info;
}

async function refreshInfo() {
  const info = await api.getWebhookInfo();
  await writeState({ last_info: info });
  return info;
}

/** Сводный статус для страницы/JSON: совпадает ли URL и нет ли ошибок. */
function buildStatus(info) {
  const expected = WEBHOOK_URL;
  const data = info || {};
  const urlMatches = data.url === expected;
  const hasError = Boolean(data.last_error_message);
  const healthy = Boolean(info) && urlMatches && !hasError;
  return { expected, healthy, urlMatches, hasError, info: data };
}

module.exports = {
  activateWebhook,
  removeWebhook,
  refreshInfo,
  buildStatus,
};
