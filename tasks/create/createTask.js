// ============================================================================
// Вставка задачи в manager_tasks (service_role, минуя RLS).
// Автор = исполнитель (задача «для себя»). Напоминание вернётся в его чат.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { DEFAULT_PRIORITY, DEFAULT_STATUS } = require("./config");

/**
 * @param {{ authorProfileId:string, title:string, description:string, dueDateUtc:string }} input
 * @returns {Promise<{ id:string, task_number:number }>}
 */
async function insertManagerTask({ authorProfileId, title, description, dueDateUtc }) {
  const payload = {
    title,
    description: description || null,
    assigned_by: authorProfileId,
    assigned_to: authorProfileId,
    assignees: [authorProfileId],
    controllers: [],
    priority: DEFAULT_PRIORITY,
    status: DEFAULT_STATUS,
    due_date: dueDateUtc,
  };

  const { data, error } = await supabase
    .from("manager_tasks")
    .insert(payload)
    .select("id, task_number")
    .single();

  if (error) throw error;
  return data;
}

/** Привязать сообщение-отбивку к задаче (для reply-напоминаний). */
async function attachTelegramOrigin(taskId, chatId, messageId) {
  const { error } = await supabase
    .from("manager_tasks")
    .update({ tg_chat_id: chatId, tg_message_id: messageId })
    .eq("id", taskId);

  if (error) {
    console.error("[tasks/create] attachTelegramOrigin:", error.message);
  }
}

module.exports = { insertManagerTask, attachTelegramOrigin };
