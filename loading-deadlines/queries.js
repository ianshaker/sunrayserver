// ============================================================================
// Supabase-запросы для модуля дедлайнов погрузки (eventsnew, type = Погрузка).
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { MSK_OFFSET_HOURS } = require("./config");

const EVENT_CARD_SELECT =
  "id, appeal_number, client_name, phone, city, detailed_address, address, place_id, dialog, note, deadline, salemanager, type";

/**
 * Возвращает дату «сегодня» по московскому времени в формате YYYY-MM-DD.
 */
function getMskTodayDate() {
  const now = new Date();
  const msk = new Date(now.getTime() + MSK_OFFSET_HOURS * 60 * 60 * 1000);
  return msk.toISOString().slice(0, 10);
}

/**
 * Дата по MSK + N календарных дней (0 = сегодня).
 *
 * @param {number} dayOffset
 * @returns {string} YYYY-MM-DD
 */
function getMskDateOffset(dayOffset) {
  const today = getMskTodayDate();
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + dayOffset));
  return date.toISOString().slice(0, 10);
}

/**
 * Есть ли событие погрузки, по которому бот уже кинул уведомление сегодня
 * (менеджер ещё не сменил дедлайн в CRM — notif_* не сброшены).
 *
 * @returns {Promise<object|null>}
 */
async function getActiveDeadlineNotif() {
  const today = getMskTodayDate();

  const { data, error } = await supabase
    .from("eventsnew")
    .select(
      "id, appeal_number, deadline_notif_sent_at, deadline_notif_tg_msg_id, deadline_reminder_tg_msg_id",
    )
    .eq("type", "Погрузка")
    .eq("deadline", today)
    .not("deadline_notif_sent_at", "is", null)
    .order("deadline_notif_sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] getActiveDeadlineNotif:", error.message);
    throw error;
  }

  return data;
}

/**
 * Следующее событие из очереди на сегодня:
 * type=Погрузка, deadline=сегодня, deadline_notif_sent_at IS NULL.
 *
 * @returns {Promise<object|null>}
 */
async function getNextDeadlineEvent() {
  const today = getMskTodayDate();

  const { data, error } = await supabase
    .from("eventsnew")
    .select(EVENT_CARD_SELECT)
    .eq("type", "Погрузка")
    .eq("deadline", today)
    .is("deadline_notif_sent_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] getNextDeadlineEvent:", error.message);
    throw error;
  }

  return data;
}

/**
 * Помечает событие как «уведомление отправлено».
 *
 * @param {number} id
 * @param {number} tgMsgId
 */
async function markDeadlineNotifSent(id, tgMsgId) {
  const { error } = await supabase
    .from("eventsnew")
    .update({
      deadline_notif_sent_at: new Date().toISOString(),
      deadline_notif_tg_msg_id: tgMsgId,
      deadline_reminder_tg_msg_id: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] markDeadlineNotifSent:", error.message);
    throw error;
  }
}

/**
 * Сохраняет message_id последнего ⏰-пинга (после удаления предыдущего).
 *
 * @param {number} id
 * @param {number|null} tgMsgId
 */
async function updateDeadlineReminderMsgId(id, tgMsgId) {
  const { error } = await supabase
    .from("eventsnew")
    .update({ deadline_reminder_tg_msg_id: tgMsgId })
    .eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] updateDeadlineReminderMsgId:", error.message);
    throw error;
  }
}

/**
 * Новая дата дедлайна: не раньше сегодня (MSK).
 *
 * @param {string} isoDate YYYY-MM-DD
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function validateNewDeadlineDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return { ok: false, reason: "Некорректная дата." };
  }
  const today = getMskTodayDate();
  if (isoDate < today) {
    return { ok: false, reason: "Новая дата не может быть раньше сегодня." };
  }
  return { ok: true };
}

/**
 * Ищет событие погрузки по appeal_number (например «#08044»).
 *
 * @param {string} appealNumber
 * @returns {Promise<object|null>}
 */
async function findLoadingEventByNumber(appealNumber) {
  const normalized = String(appealNumber || "")
    .replace(/^#/, "")
    .trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("eventsnew")
    .select(
      `${EVENT_CARD_SELECT}, deadline_notif_sent_at, deadline_notif_tg_msg_id, deadline_reminder_tg_msg_id`,
    )
    .eq("type", "Погрузка")
    .ilike("appeal_number", `%${normalized}%`)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] findLoadingEventByNumber:", error.message);
    throw error;
  }

  return data;
}

/**
 * Перенос дедлайна погрузки: новая дата + сброс трекинга уведомлений.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 */
async function rescheduleLoadingDeadline(id, newDate) {
  const { error } = await supabase
    .from("eventsnew")
    .update({
      deadline: newDate,
      deadline_notif_sent_at: null,
      deadline_notif_tg_msg_id: null,
      deadline_reminder_tg_msg_id: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] rescheduleLoadingDeadline:", error.message);
    throw error;
  }
}

/**
 * Применяет структурные обновления + блок в dialog + перенос deadline.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 * @param {{ fieldPatch?: object, dialogAppend?: string | null }} payload
 */
async function applyInfoAddedAndRescheduleLoading(id, newDate, { fieldPatch = {}, dialogAppend = null }) {
  const { data: row, error: readErr } = await supabase
    .from("eventsnew")
    .select("dialog")
    .eq("id", id)
    .single();

  if (readErr) {
    console.error("[loading-deadlines/queries] applyInfoAdded read:", readErr.message);
    throw readErr;
  }

  const existing = (row?.dialog || "").trim();
  const append = String(dialogAppend || "").trimStart();
  const newDialog = append ? (existing ? existing + append : append.trim()) : existing;

  const updatePayload = {
    ...fieldPatch,
    deadline: newDate,
    deadline_notif_sent_at: null,
    deadline_notif_tg_msg_id: null,
    deadline_reminder_tg_msg_id: null,
  };

  if (append) {
    updatePayload.dialog = newDialog;
  }

  const { error } = await supabase.from("eventsnew").update(updatePayload).eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] applyInfoAddedAndRescheduleLoading:", error.message);
    throw error;
  }
}

/**
 * Уже есть отказ в appealsotkaz по номеру заявки?
 * (CRM из погрузки пишет именно туда, не в zamerotkaz.)
 *
 * @param {string} appealNumber
 */
async function findExistingAppealsOtkaz(appealNumber) {
  const normalized = String(appealNumber || "")
    .replace(/^#/, "")
    .trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("appealsotkaz")
    .select("id, appeal_number, created_at")
    .ilike("appeal_number", `%${normalized}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] findExistingAppealsOtkaz:", error.message);
    throw error;
  }

  return data;
}

/**
 * @param {object} row
 */
async function insertAppealsOtkaz(row) {
  const { data, error } = await supabase.from("appealsotkaz").insert(row).select().single();

  if (error) {
    console.error("[loading-deadlines/queries] insertAppealsOtkaz:", error.message);
    throw error;
  }

  return data;
}

/**
 * Зеркало CRM: ids.otkaz = 'отказ' (lowercase) по appeal_id.
 *
 * @param {string} appealNumber
 */
async function updateIdsOtkazFromLoading(appealNumber) {
  if (!appealNumber) return;

  const { error } = await supabase
    .from("ids")
    .update({ otkaz: "отказ" })
    .eq("appeal_id", appealNumber);

  if (error) {
    console.error("[loading-deadlines/queries] updateIdsOtkazFromLoading:", error.message);
    throw error;
  }
}

/**
 * @param {number} id
 */
async function deleteLoadingEventById(id) {
  const { error } = await supabase.from("eventsnew").delete().eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] deleteLoadingEventById:", error.message);
    throw error;
  }
}

/**
 * Уже есть строка в appeals с этим номером? (unique / блок возврата из погрузки)
 *
 * @param {string} appealNumber
 */
async function findExistingAppealByNumber(appealNumber) {
  const normalized = String(appealNumber || "").trim();
  if (!normalized) return null;

  const variants = [normalized];
  const bare = normalized.replace(/^#/, "");
  if (bare !== normalized) variants.push(bare);
  else variants.push(`#${bare}`);

  const { data, error } = await supabase
    .from("appeals")
    .select("id, appeal_number, status")
    .in("appeal_number", variants)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] findExistingAppealByNumber:", error.message);
    throw error;
  }

  return data;
}

/**
 * INSERT во входящие при возврате из погрузки (зеркало CRM).
 *
 * @param {object} row
 */
async function insertAppealFromLoadingReturn(row) {
  const { data, error } = await supabase.from("appeals").insert(row).select().single();

  if (error) {
    console.error("[loading-deadlines/queries] insertAppealFromLoadingReturn:", error.message);
    throw error;
  }

  return data;
}

/**
 * Read-only список событий погрузки с дедлайном (для Q&A менеджера).
 * Не трогает deadline_notif_* — это не очередь push-уведомлений.
 *
 * @param {{ mode: 'by_date'|'urgent'|'recent_past', date?: string, limit: number }} opts
 * @returns {Promise<{ events: object[], truncated: boolean, totalMatched: number }>}
 */
async function listLoadingDeadlinesForQuery({ mode, date, limit }) {
  const fetchLimit = Math.max(1, limit) + 1;

  let q = supabase
    .from("eventsnew")
    .select(EVENT_CARD_SELECT)
    .eq("type", "Погрузка")
    .not("deadline", "is", null);

  if (mode === "urgent") {
    const today = getMskTodayDate();
    q = q
      .lte("deadline", today)
      .order("deadline", { ascending: true })
      .order("id", { ascending: false });
  } else if (mode === "recent_past") {
    // N ближайших к сегодня, но строго раньше сегодня (не угадывать «вчера»).
    const today = getMskTodayDate();
    q = q
      .lt("deadline", today)
      .order("deadline", { ascending: false })
      .order("id", { ascending: false });
  } else {
    q = q.eq("deadline", date).order("id", { ascending: false });
  }

  const { data, error } = await q.limit(fetchLimit);

  if (error) {
    console.error("[loading-deadlines/queries] listLoadingDeadlinesForQuery:", error.message);
    throw error;
  }

  const rows = data || [];
  const truncated = rows.length > limit;
  const events = truncated ? rows.slice(0, limit) : rows;

  return {
    events,
    truncated,
    totalMatched: truncated ? limit + 1 : events.length,
  };
}

module.exports = {
  getMskTodayDate,
  getMskDateOffset,
  validateNewDeadlineDate,
  getActiveDeadlineNotif,
  getNextDeadlineEvent,
  markDeadlineNotifSent,
  updateDeadlineReminderMsgId,
  findLoadingEventByNumber,
  rescheduleLoadingDeadline,
  applyInfoAddedAndRescheduleLoading,
  findExistingAppealsOtkaz,
  insertAppealsOtkaz,
  updateIdsOtkazFromLoading,
  deleteLoadingEventById,
  findExistingAppealByNumber,
  insertAppealFromLoadingReturn,
  listLoadingDeadlinesForQuery,
};
