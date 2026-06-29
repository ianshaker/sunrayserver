const { supabase } = require("./supabaseClient");
const { ACTIVE_TASK_STATUSES } = require("./config");

async function fetchActiveTaskByNumber(taskNumber) {
  const { data, error } = await supabase
    .from("manager_tasks")
    .select("id, task_number, title, status, assignees, assigned_to, assigned_by, controllers, due_date")
    .eq("task_number", taskNumber)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!ACTIVE_TASK_STATUSES.includes(data.status)) return null;
  return data;
}

/** Ключи mt:10 | mt:30 | mt:1h | mt:tm в callback_data. */
const SNOOZE_PRESETS = {
  "10": { label: "10 мин", minutes: 10 },
  "30": { label: "30 мин", minutes: 30 },
  "1h": { label: "1 час", minutes: 60 },
  tm: { label: "Завтра" },
};

function computeSnoozedUntil(task, presetKey) {
  const preset = SNOOZE_PRESETS[presetKey];
  if (!preset) return null;

  if (presetKey === "tm") {
    const base = task.due_date ? new Date(task.due_date) : new Date();
    return new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }

  return new Date(Date.now() + preset.minutes * 60 * 1000).toISOString();
}

async function snoozeTaskByNumber(taskNumber, presetKey) {
  const task = await fetchActiveTaskByNumber(taskNumber);
  if (!task) return { ok: false, reason: "not_found" };

  const snoozedUntil = computeSnoozedUntil(task, presetKey);
  if (!snoozedUntil) return { ok: false, reason: "bad_preset" };

  const { error } = await supabase
    .from("manager_tasks")
    .update({
      due_date: snoozedUntil,
      due_reminder_sent_at: null,
    })
    .eq("id", task.id);

  if (error) throw error;
  return { ok: true, task, snoozedUntil, presetKey, label: SNOOZE_PRESETS[presetKey].label };
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
  SNOOZE_PRESETS,
  fetchActiveTaskByNumber,
  snoozeTaskByNumber,
  completeTaskByNumber,
};
