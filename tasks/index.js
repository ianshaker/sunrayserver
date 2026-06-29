// ============================================================================
// tasks — уведомления о задачах менеджеров (CRM → Telegram).
//
// Единая точка входа. server.js подключает только отсюда.
//
// Поток:
//   CRM POST /tasks/manager → routes → handlers → messages → Telegram
//   cron reminder → Supabase manager_tasks → TG каждые 30 мин после дедлайна
//   callback кнопок → проверка прав по profiles.telegram_user_id
//   входящие сообщения → telegram_bot_chats (право task_create), AI — позже
//
// Источник Telegram-личности: таблица profiles (telegram_chat_id / username /
// user_id), кэш в directory.js.
// Разрешённые чаты бота: telegram_bot_chats, кэш в lib/telegramBotChats.js.
// ============================================================================

const { registerTaskRoute } = require("./routes");
const config = require("./config");
const {
  getChatIdForUser,
  startDirectoryRefresh,
  resolveProfileIdByTelegramUser,
} = require("./directory");
const {
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
} = require("./handlers");
const { startTaskReminderWorker } = require("./reminder/worker");

module.exports = {
  registerTaskRoute,
  startTaskReminderWorker,
  startDirectoryRefresh,
  config,
  getChatIdForUser,
  resolveProfileIdByTelegramUser,
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
};
