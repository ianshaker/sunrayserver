const { supabase } = require("./supabaseClient");
const { ACTIVE_TASK_STATUSES } = require("./config");

const TASK_FIELDS =
  "id, task_number, title, status, assignees, assigned_to, assigned_by, controllers, due_date, tg_chat_id, tg_message_id";

async function fetchActiveTaskByNumber(taskNumber) {
  const { data, error } = await supabase
    .from("manager_tasks")
    .select(TASK_FIELDS)
    .eq("task_number", taskNumber)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (!ACTIVE_TASK_STATUSES.includes(data.status)) return null;
  return data;
}

/**
 * Все активные задачи для контекстного поиска (Ветка B ассистента).
 * Возвращает только поля, нужные для Gemini-промпта.
 */
async function fetchActiveTasksForContext() {
  const { data, error } = await supabase
    .from("manager_tasks")
    .select("task_number, title, description, due_date, status")
    .in("status", ACTIVE_TASK_STATUSES)
    .order("task_number", { ascending: false })
    .limit(200);

  if (error) throw error;
  return data || [];
}

/** Задача по номеру: сначала активная, иначе архив (для «уже закрыта»). */
async function fetchTaskByNumberAny(taskNumber) {
  const { data, error } = await supabase
    .from("manager_tasks")
    .select(TASK_FIELDS)
    .eq("task_number", taskNumber)
    .maybeSingle();

  if (error) throw error;
  if (data) return { ...data, _source: "active" };

  const { data: archived, error: archErr } = await supabase
    .from("manager_tasks_archive")
    .select(`${TASK_FIELDS}, archived_at`)
    .eq("task_number", taskNumber)
    .maybeSingle();

  if (archErr) throw archErr;
  if (archived) return { ...archived, _source: "archive" };
  return null;
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

  await completeTask(task.id);
  return { ok: true, task };
}

// --- Действия по id (для команд ассистента: задачу уже нашли и проверили права) --- //

/** Завершить → триггер БД переносит в архив. */
async function completeTask(taskId) {
  const { error } = await supabase
    .from("manager_tasks")
    .update({ status: "completed" })
    .eq("id", taskId);

  if (error) throw error;
}

/** Отменить → триггер БД переносит в архив. */
async function cancelTask(taskId) {
  const { error } = await supabase
    .from("manager_tasks")
    .update({ status: "cancelled" })
    .eq("id", taskId);

  if (error) throw error;
}

/** Удалить навсегда (без архива). Только из manager_tasks. */
async function deleteTask(taskId) {
  const { error } = await supabase.from("manager_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

/** Перенести: новый дедлайн + сброс метки, чтобы напоминание пришло заново. */
async function rescheduleTask(taskId, dueDateUtc) {
  const { error } = await supabase
    .from("manager_tasks")
    .update({ due_date: dueDateUtc, due_reminder_sent_at: null })
    .eq("id", taskId);

  if (error) throw error;
}

module.exports = {
  SNOOZE_PRESETS,
  fetchActiveTaskByNumber,
  fetchTaskByNumberAny,
  fetchActiveTasksForContext,
  snoozeTaskByNumber,
  completeTaskByNumber,
  completeTask,
  cancelTask,
  deleteTask,
  rescheduleTask,
};
