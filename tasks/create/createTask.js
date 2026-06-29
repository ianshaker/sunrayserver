// ============================================================================
// Вставка задачи в manager_tasks (service_role, минуя RLS).
// Автор всегда включён в исполнители. Если задача создана «для кого-то»,
// extraAssigneeId добавляется к assignees и становится primary assigned_to.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { DEFAULT_PRIORITY, DEFAULT_STATUS } = require("./config");

/**
 * @param {{ authorProfileId:string, title:string, description:string,
 *           dueDateUtc:string, extraAssigneeId?: string|null }} input
 * @returns {Promise<{ id:string, task_number:number }>}
 */
async function insertManagerTask({ authorProfileId, title, description, dueDateUtc, extraAssigneeId }) {
  // Автор всегда в исполнителях. Если есть доп. исполнитель — он идёт первым
  // (assigned_to = primaryAssignee = тот, кому пошлёт напоминание).
  const assignees = extraAssigneeId
    ? [...new Set([extraAssigneeId, authorProfileId])]
    : [authorProfileId];
  const primaryAssignee = assignees[0];

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
