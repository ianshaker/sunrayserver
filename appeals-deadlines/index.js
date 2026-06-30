// ============================================================================
// Модуль «Дедлайны входящих» — точка входа.
//
// Подключается в server.js:
//   const { startAppealDeadlineWorker } = require("./appeals-deadlines");
//   registerIntent(require("./appeals-deadlines/intent"));
//   // в onListen:
//   startAppealDeadlineWorker(telegramBot);
// ============================================================================

const { startAppealDeadlineWorker, runDeadlineCheck } = require("./worker");

module.exports = { startAppealDeadlineWorker, runDeadlineCheck };
