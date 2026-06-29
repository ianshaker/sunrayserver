const { supabase } = require("../supabaseClient");
const { ACTIVE_TASK_STATUSES, REMINDER_INTERVAL_MS } = require("../config");

const TASK_SELECT =
  "id, title, description, due_date, due_reminder_sent_at, priority, status, assignees, assigned_to, assigned_by";

async function fetchTasksDueForReminder() {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("manager_tasks")
    .select(TASK_SELECT)
    .in("status", ACTIVE_TASK_STATUSES)
    .not("due_date", "is", null)
    .lte("due_date", now);

  if (error) throw error;
  return data || [];
}

function isReminderDue(task) {
  if (!task.due_reminder_sent_at) return true;
  const lastSent = new Date(task.due_reminder_sent_at).getTime();
  return Date.now() - lastSent >= REMINDER_INTERVAL_MS;
}

async function claimTaskForReminder(taskId) {
  const { data, error } = await supabase.rpc("claim_manager_task_due_reminder", {
    p_task_id: taskId,
  });

  if (error) throw error;
  return data?.[0] || null;
}

async function updateTaskDescription(taskId, description) {
  const { error } = await supabase
    .from("manager_tasks")
    .update({ description })
    .eq("id", taskId);

  if (error) throw error;
}

module.exports = {
  fetchTasksDueForReminder,
  isReminderDue,
  claimTaskForReminder,
  updateTaskDescription,
};
