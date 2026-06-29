// ============================================================================
// tgwebhook — единый переиспользуемый Telegram-вебхук.
//
// Публичный API модуля:
//   registerTelegramWebhook(fastify)   — регистрирует роуты (вебхук + страница)
//   startWebhookSelfHeal()             — self-heal после старта/redeploy
//   setTelegramBot(bot)                — экземпляр бота для ответов из хендлеров
//   registerDiagnosticsHandlers()      — команды /ping и /id (проверка канала)
//
//   onMessage(fn) / onCallbackQuery(fn) / onUpdate(fn)
//     — подписка на входящие события (для напоминаний, нейронок, отделов)
//
//   activateWebhook / removeWebhook / refreshInfo / buildStatus
//     — программное управление (если понадобится вне страницы)
//
//   config — все пути/секреты/константы
// ============================================================================

const { registerTelegramWebhook } = require("./routes");
const { startWebhookSelfHeal, ensureWebhookHealthy } = require("./selfheal");
const {
  onMessage,
  onCallbackQuery,
  onUpdate,
  dispatchUpdate,
} = require("./dispatcher");
const { setTelegramBot, getTelegramBot } = require("./bot");
const {
  activateWebhook,
  removeWebhook,
  refreshInfo,
  buildStatus,
} = require("./manager");
const { registerDiagnosticsHandlers } = require("./handlers/diagnostics");
const config = require("./config");

module.exports = {
  registerTelegramWebhook,
  startWebhookSelfHeal,
  ensureWebhookHealthy,
  setTelegramBot,
  getTelegramBot,
  onMessage,
  onCallbackQuery,
  onUpdate,
  dispatchUpdate,
  activateWebhook,
  removeWebhook,
  refreshInfo,
  buildStatus,
  registerDiagnosticsHandlers,
  config,
};
