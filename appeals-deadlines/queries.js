// ============================================================================
// Supabase-запросы для модуля дедлайнов входящих.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { MSK_OFFSET_HOURS } = require("./config");

/**
 * Возвращает дату «сегодня» по московскому времени в формате YYYY-MM-DD.
 */
function getMskTodayDate() {
  const now = new Date();
  const msk = new Date(now.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000);
  return msk.toISOString().slice(0, 10);
}

/**
 * Проверяет, есть ли заявка, по которой бот уже кинул уведомление сегодня,
 * но менеджер ещё не отреагировал (deadline_resolved_at IS NULL).
 *
 * @returns {Promise<object|null>} Активная заявка или null.
 */
async function getActiveDeadlineNotif() {
  const today = getMskTodayDate();

  const { data, error } = await supabase
    .from("appeals")
    .select("id, appeal_number, deadline_notif_sent_at, deadline_notif_tg_msg_id")
    .eq("reminder_date", today)
    .not("deadline_notif_sent_at", "is", null)
    .is("deadline_resolved_at", null)
    .eq("status", "Активно")
    .order("deadline_notif_sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] getActiveDeadlineNotif:", error.message);
    throw error;
  }

  return data;
}

/**
 * Берёт следующую заявку из очереди на сегодня:
 * reminder_date = сегодня, deadline_notif_sent_at IS NULL, status = Активно.
 *
 * @returns {Promise<object|null>}
 */
async function getNextDeadlineAppeal() {
  const today = getMskTodayDate();

  const { data, error } = await supabase
    .from("appeals")
    .select(
      "id, appeal_number, client_name, phone, city, detailed_address, address, dialog, reminder_date, manager",
    )
    .eq("reminder_date", today)
    .is("deadline_notif_sent_at", null)
    .is("deadline_resolved_at", null)
    .eq("status", "Активно")
    .or("is_spam.is.null,is_spam.eq.false")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] getNextDeadlineAppeal:", error.message);
    throw error;
  }

  return data;
}

/**
 * Помечает заявку как «уведомление отправлено».
 *
 * @param {number} id
 * @param {number} tgMsgId
 */
async function markDeadlineNotifSent(id, tgMsgId) {
  const { error } = await supabase
    .from("appeals")
    .update({
      deadline_notif_sent_at: new Date().toISOString(),
      deadline_notif_tg_msg_id: tgMsgId,
    })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] markDeadlineNotifSent:", error.message);
    throw error;
  }
}

/**
 * Перенос дедлайна: новая дата + сброс трекинга уведомлений.
 *
 * Заявка выпадает из «активной» очереди на сегодня (reminder_date уже не сегодня),
 * а в новую дату снова попадёт в очередь как новая карточка.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 */
async function rescheduleAppealDeadline(id, newDate) {
  const { error } = await supabase
    .from("appeals")
    .update({
      reminder_date: newDate,
      deadline_notif_sent_at: null,
      deadline_notif_tg_msg_id: null,
      deadline_resolved_at: null,
      deadline_resolution: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] rescheduleAppealDeadline:", error.message);
    throw error;
  }
}

/**
 * Помечает заявку как «менеджер отреагировал» (отказ, погрузка и т.д.).
 * Для переноса дедлайна используйте rescheduleAppealDeadline — там сброс трекинга.
 *
 * @param {number} id
 * @param {'reschedule'|'reject'|'loading'|'info_added'|'manual'} resolution
 */
async function markDeadlineResolved(id, resolution) {
  const { error } = await supabase
    .from("appeals")
    .update({
      deadline_resolved_at: new Date().toISOString(),
      deadline_resolution: resolution,
    })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] markDeadlineResolved:", error.message);
    throw error;
  }
}

/**
 * Обновляет дату дедлайна (reminder_date) заявки.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 */
async function updateAppealReminderDate(id, newDate) {
  const { error } = await supabase
    .from("appeals")
    .update({ reminder_date: newDate })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] updateAppealReminderDate:", error.message);
    throw error;
  }
}

/**
 * Ищет заявку по appeal_number (например «#08044»).
 *
 * @param {string} appealNumber
 * @returns {Promise<object|null>}
 */
async function findAppealByNumber(appealNumber) {
  const normalized = appealNumber.replace(/^#/, "").trim();

  const { data, error } = await supabase
    .from("appeals")
    .select("id, appeal_number, client_name, phone, reminder_date, status, deadline_resolved_at")
    .ilike("appeal_number", `%${normalized}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] findAppealByNumber:", error.message);
    throw error;
  }

  return data;
}

module.exports = {
  getMskTodayDate,
  getActiveDeadlineNotif,
  getNextDeadlineAppeal,
  markDeadlineNotifSent,
  markDeadlineResolved,
  rescheduleAppealDeadline,
  updateAppealReminderDate,
  findAppealByNumber,
};
