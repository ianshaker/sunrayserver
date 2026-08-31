#!/usr/bin/env node
// ============================================================================
// Ручная проверка чтения Яндекс.Почты.
//
//   node yandexmail/run-health-check.js
//
// Подключается, открывает папку только на чтение, показывает последние письма
// и уходит. Ничего не меняет ни в почте, ни в базе.
// ============================================================================

const { runHealthCheck, formatReport } = require("./health/check");

runHealthCheck({ days: 2, limit: 5 })
  .then((report) => {
    console.log(formatReport(report));
    process.exit(report.ok ? 0 : 1);
  })
  .catch((error) => {
    console.error("[yandexmail] проверка сорвалась:", error.message);
    process.exit(1);
  });
