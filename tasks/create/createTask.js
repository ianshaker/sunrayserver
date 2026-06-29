// ============================================================================
// Вставка задачи в manager_tasks (service_role, минуя RLS).
// Автор всегда включён в исполнители. Если задача создана «для кого-то»,
// extraAssigneeId добавляется к assignees и становится primary assigned_to.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { DEFAULT_PRIORITY, DEFAULT_STATUS } = require("./config");

/**
 * @param {{ authorProfileId:string, title:string, description:string,
 *           dueDateUtc:string, coAssigneeIds?: string[] }} input
 */
async function insertManagerTask({ authorProfileId, title, description, dueDateUtc, coAssigneeIds = [] }) {
  const co = [...new Set(coAssigneeIds.filter(Boolean))].filter((id) => id !== authorProfileId);
  const assignees = co.length ? [...co, authorProfileId] : [authorProfileId];
  const primaryAssignee = co[0] || authorProfileId;

  const payload = {
    title,
    description: description || null,
    assigned_by: authorProfileId,
    assigned_to: primaryAssignee,
    assignees,
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
