// ============================================================================
// tasks — уведомления о задачах менеджеров (CRM → Telegram).
//
// Единая точка входа. server.js подключает только отсюда.
//
// Поток:
//   CRM POST /tasks/manager → routes → handlers → messages → Telegram
//
// Расширение (будущее):
//   - AI-сводки / напоминания по due_date → отдельные workers в этой папке
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

module.exports = {
  registerTaskRoute,
  config,
  getChatIdForUser,
  USER_CHAT_MAPPING,
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
};
