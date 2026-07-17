// ============================================================================
// Модуль: JPEG графика мастера → личный TG-чат.
//
//   const { registerMasterScheduleRoute } = require("./master-schedule");
//   registerMasterScheduleRoute(fastify);
//
// Эндпоинт: POST /events/master-schedule
// ============================================================================

const { registerMasterScheduleRoute } = require("./route");

module.exports = {
  registerMasterScheduleRoute,
};
