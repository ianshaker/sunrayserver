// ============================================================================
// postamails — заявки с Gmail + веб-активация OAuth (без Telegram polling).
//
// Поток почты:
//   cron → Gmail API → парсинг → Supabase appeals → Telegram (исходящие)
//
// Поток OAuth:
//   Telegram (ссылка) → GET /gmail/setup → Google → код → POST /gmail/exchange-code
// ============================================================================

const { registerGmailAuthRoutes } = require("./auth/routes");
const { startEmailChecker } = require("./checker/scheduler");
const { insertAppealFromEmail } = require("./appeals/insertFromEmail");

module.exports = {
  registerGmailAuthRoutes,
  startEmailChecker,
  insertAppealFromEmail,
};
