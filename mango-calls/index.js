// ============================================================================
// mango-calls — админ-чистка строк без файла записи (CRM Settings).
//
// НЕ часть call-ai (STT / саммари) и не webhook-обработчик mango.calls.new.js.
// Только: POST /api/mango-calls/delete (Bearer superadmin) → удаление строк
// где storage_path IS NULL.
//
// Подключение в server.js:
//   const { registerMangoCallsRoutes } = require("./mango-calls");
//   registerMangoCallsRoutes(fastify);
// ============================================================================

const { registerMangoCallsRoutes } = require("./routes");
const { deleteRowsByIds } = require("./cleanup");

module.exports = {
  registerMangoCallsRoutes,
  deleteRowsByIds,
};
