// ============================================================================
// tasks — уведомления о задачах менеджеров (CRM → Telegram).
//
// Единая точка входа. server.js подключает только отсюда.
//
// Поток:
//   CRM POST /tasks/manager → routes → handlers → messages → Telegram
//   cron reminder → Supabase manager_tasks → TG каждые 30 мин после дедлайна
//
// Расширение (будущее):
//   - chatMapping → позже в Supabase profiles.telegram_chat_id
// ============================================================================

const { registerTaskRoute } = require("./routes");
const config = require("./config");
const { getChatIdForUser, USER_CHAT_MAPPING } = require("./chatMapping");
const {
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
} = require("./handlers");
const { startTaskReminderWorker } = require("./reminder/worker");

module.exports = {
  registerTaskRoute,
  startTaskReminderWorker,
  config,
  getChatIdForUser,
  USER_CHAT_MAPPING,
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
};
