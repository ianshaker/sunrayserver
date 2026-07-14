// ============================================================================
// Модуль «Инфо на замер» — TG-уведомления по событиям CRM.
//
// Замер / монтаж / рекламация / погрузка → чаты мастеров или чат погрузки.
// Подключается в server.js:
//   const { registerZamerRoute } = require("./info-na-zamer");
//   registerZamerRoute(fastify, telegramBot);
//
// Эндпоинт: POST /events/zamer (имя историческое; тип — body.eventType).
// ============================================================================

const { registerZamerRoute } = require("./route");
const { resolveEventLabels } = require("./labels");

module.exports = {
  registerZamerRoute,
  resolveEventLabels,
};
