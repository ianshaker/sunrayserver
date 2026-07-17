// ============================================================================
// Модуль «Очередь монтажа» — PDF-скан договора в монтажный TG-чат.
//
// Подключается в server.js:
//   const { registerInstallationQueueRoute } = require("./installation-queue");
//   registerInstallationQueueRoute(fastify, telegramBot);
//
// Эндпоинт: POST /events/installation-queue
// ============================================================================

const { registerInstallationQueueRoute } = require("./route");
const {
  formatInstallationCaption,
  escapeHtml,
  safeFilename,
} = require("./caption");

module.exports = {
  registerInstallationQueueRoute,
  formatInstallationCaption,
  escapeHtml,
  safeFilename,
};
