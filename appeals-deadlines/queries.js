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
 * Проверяет, есть ли заявка, по которой бот уже кинул уведомление сегодня,
 * но менеджер ещё не отреагировал (deadline_resolved_at IS NULL).
 *
 * @returns {Promise<object|null>} Активная заявка или null.
 */
async function getActiveDeadlineNotif() {
  const today = getMskTodayDate();

  const { data, error } = await supabase
    .from("appeals")
    .select(
      "id, appeal_number, deadline_notif_sent_at, deadline_notif_tg_msg_id, deadline_reminder_tg_msg_id",
    )
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
      deadline_reminder_tg_msg_id: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] markDeadlineNotifSent:", error.message);
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
    .from("appeals")
    .update({ deadline_reminder_tg_msg_id: tgMsgId })
    .eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] updateDeadlineReminderMsgId:", error.message);
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
      deadline_reminder_tg_msg_id: null,
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
 * Новая дата дедлайна: не раньше сегодня (MSK). Дата без времени — «сегодня» допустимо.
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
 * Применяет структурные обновления + блок в dialog + перенос reminder_date.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 * @param {{ fieldPatch?: object, dialogAppend?: string | null }} payload
 */
async function applyInfoAddedAndRescheduleAppeal(id, newDate, { fieldPatch = {}, dialogAppend = null }) {
  const { data: row, error: readErr } = await supabase
    .from("appeals")
    .select("dialog")
    .eq("id", id)
    .single();

  if (readErr) {
    console.error("[appeals-deadlines/queries] applyInfoAdded read:", readErr.message);
    throw readErr;
  }

  const existing = (row?.dialog || "").trim();
  const append = String(dialogAppend || "").trimStart();
  const newDialog = append ? (existing ? existing + append : append.trim()) : existing;

  const updatePayload = {
    ...fieldPatch,
    reminder_date: newDate,
    deadline_notif_sent_at: null,
    deadline_notif_tg_msg_id: null,
    deadline_reminder_tg_msg_id: null,
    deadline_resolved_at: null,
    deadline_resolution: null,
  };

  if (append) {
    updatePayload.dialog = newDialog;
  }

  const { error } = await supabase.from("appeals").update(updatePayload).eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] applyInfoAddedAndRescheduleAppeal:", error.message);
    throw error;
  }
}

/** @deprecated используйте applyInfoAddedAndRescheduleAppeal */
async function appendDialogAndRescheduleAppeal(id, newDate, dialogAppend) {
  return applyInfoAddedAndRescheduleAppeal(id, newDate, { dialogAppend });
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
    .select(
      "id, appeal_number, client_name, phone, city, address, detailed_address, reminder_date, reminder_time, status, deadline_resolved_at, deadline_reminder_tg_msg_id, dialog, product_type, source, manager, task_description",
    )
    .ilike("appeal_number", `%${normalized}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] findAppealByNumber:", error.message);
    throw error;
  }

  return data;
}

/**
 * Уже есть событие погрузки по номеру заявки?
 *
 * @param {string} appealNumber
 */
async function findExistingLoadingEvent(appealNumber) {
  const normalized = cleanAppealNumberForQuery(appealNumber);

  const { data, error } = await supabase
    .from("eventsnew")
    .select("id, appeal_number, created_at")
    .eq("type", "Погрузка")
    .ilike("appeal_number", `%${normalized.replace(/^#/, "")}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] findExistingLoadingEvent:", error.message);
    throw error;
  }

  return data;
}

function cleanAppealNumberForQuery(appealNumber) {
  return String(appealNumber || "").replace(/^#+/, "#");
}

/**
 * @param {object} row
 * @returns {Promise<object>}
 */
async function insertLoadingEvent(row) {
  const { data, error } = await supabase.from("eventsnew").insert(row).select().single();

  if (error) {
    console.error("[appeals-deadlines/queries] insertLoadingEvent:", error.message);
    throw error;
  }

  return data;
}

/**
 * @param {number} id
 */
async function deleteAppealById(id) {
  const { error } = await supabase.from("appeals").delete().eq("id", id);

  if (error) {
    console.error("[appeals-deadlines/queries] deleteAppealById:", error.message);
    throw error;
  }
}

/**
 * Уже есть отказ по номеру заявки?
 *
 * @param {string} appealNumber
 */
async function findExistingReject(appealNumber) {
  const normalized = cleanAppealNumberForQuery(appealNumber).replace(/^#/, "");

  const { data, error } = await supabase
    .from("appealsotkaz")
    .select("id, appeal_number, created_at")
    .ilike("appeal_number", `%${normalized}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[appeals-deadlines/queries] findExistingReject:", error.message);
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
    console.error("[appeals-deadlines/queries] insertAppealsOtkaz:", error.message);
    throw error;
  }

  return data;
}

/**
 * @param {string} appealNumber
 */
async function updateIdsOtkaz(appealNumber) {
  const { error } = await supabase
    .from("ids")
    .update({ otkaz: "Отказ" })
    .eq("appeal_id", appealNumber);

  if (error) {
    console.error("[appeals-deadlines/queries] updateIdsOtkaz:", error.message);
    throw error;
  }
}

const APPEAL_CARD_SELECT =
  "id, appeal_number, client_name, phone, city, detailed_address, address, dialog, reminder_date, manager";

/**
 * Read-only список активных входящих по reminder_date (для Q&A менеджера).
 * Не трогает deadline_notif_* — это не очередь push-уведомлений.
 *
 * @param {{ mode: 'by_date'|'urgent'|'recent_past', date?: string, limit: number }} opts
 * @returns {Promise<{ appeals: object[], truncated: boolean, totalMatched: number }>}
 */
async function listAppealsForDeadlineQuery({ mode, date, limit }) {
  const fetchLimit = Math.max(1, limit) + 1; // +1 чтобы понять, что есть ещё

  let q = supabase
    .from("appeals")
    .select(APPEAL_CARD_SELECT)
    .eq("status", "Активно")
    .or("is_spam.is.null,is_spam.eq.false");

  if (mode === "urgent") {
    const today = getMskTodayDate();
    q = q
      .lte("reminder_date", today)
      .not("reminder_date", "is", null)
      .order("reminder_date", { ascending: true })
      .order("id", { ascending: false });
  } else if (mode === "recent_past") {
    // N ближайших к сегодня, но строго раньше сегодня (не угадывать «вчера»).
    const today = getMskTodayDate();
    q = q
      .lt("reminder_date", today)
      .not("reminder_date", "is", null)
      .order("reminder_date", { ascending: false })
      .order("id", { ascending: false });
  } else {
    q = q.eq("reminder_date", date).order("id", { ascending: false });
  }

  const { data, error } = await q.limit(fetchLimit);

  if (error) {
    console.error("[appeals-deadlines/queries] listAppealsForDeadlineQuery:", error.message);
    throw error;
  }

  const rows = data || [];
  const truncated = rows.length > limit;
  const appeals = truncated ? rows.slice(0, limit) : rows;

  return {
    appeals,
    truncated,
    totalMatched: truncated ? limit + 1 : appeals.length,
  };
}

module.exports = {
  getMskTodayDate,
  getMskDateOffset,
  validateNewDeadlineDate,
  getActiveDeadlineNotif,
  getNextDeadlineAppeal,
  markDeadlineNotifSent,
  updateDeadlineReminderMsgId,
  markDeadlineResolved,
  rescheduleAppealDeadline,
  appendDialogAndRescheduleAppeal,
  applyInfoAddedAndRescheduleAppeal,
  updateAppealReminderDate,
  findAppealByNumber,
  findExistingLoadingEvent,
  insertLoadingEvent,
  deleteAppealById,
  findExistingReject,
  insertAppealsOtkaz,
  updateIdsOtkaz,
  listAppealsForDeadlineQuery,
};
