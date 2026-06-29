const { supabase } = require("./supabaseClient");
const { ACTIVE_TASK_STATUSES } = require("./config");

async function fetchActiveTaskByNumber(taskNumber) {
  const { data, error } = await supabase
    .from("manager_tasks")
    .select("id, task_number, title, status, assignees, assigned_to, due_date")
    .eq("task_number", taskNumber)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!ACTIVE_TASK_STATUSES.includes(data.status)) return null;
  return data;
}

async function snoozeTaskByNumber(taskNumber) {
  const task = await fetchActiveTaskByNumber(taskNumber);
  if (!task) return { ok: false, reason: "not_found" };

  const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("manager_tasks")
    .update({
      due_date: snoozedUntil,
      due_reminder_sent_at: null,
    })
    .eq("id", task.id);

  if (error) throw error;
  return { ok: true, task, snoozedUntil };
}

async function completeTaskByNumber(taskNumber) {
  const task = await fetchActiveTaskByNumber(taskNumber);
  if (!task) return { ok: false, reason: "not_found" };

  const { error } = await supabase
    .from("manager_tasks")
    .update({ status: "completed" })
    .eq("id", task.id);

  if (error) throw error;
  return { ok: true, task };
}

module.exports = {
  fetchActiveTaskByNumber,
  snoozeTaskByNumber,
  completeTaskByNumber,
};
