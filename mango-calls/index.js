// ============================================================================
// mango-calls — API для CRM:
//   POST /api/mango-calls/delete     — Bearer superadmin, чистка строк без файла
//   POST /api/mango-calls/request-ai — Bearer authenticated, ручной STT→саммари
//
// НЕ часть call-ai (воркеры) и не webhook mango.calls.new.js.
//
// Подключение в server.js:
//   const { registerMangoCallsRoutes } = require("./mango-calls");
//   registerMangoCallsRoutes(fastify);
// ============================================================================

const { registerMangoCallsRoutes } = require("./routes");
const { deleteRowsByIds } = require("./cleanup");
const { requestAiForCall } = require("./requestAi");

module.exports = {
  registerMangoCallsRoutes,
  deleteRowsByIds,
  requestAiForCall,
};
