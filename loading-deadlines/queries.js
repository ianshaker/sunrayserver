// ============================================================================
// Supabase-запросы для модуля дедлайнов погрузки (eventsnew, type = Погрузка).
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { mskDate, mskClock } = require("../lib/mskTime");
const { normalizeDeadlineTime } = require("./messages");

const EVENT_CARD_SELECT =
  "id, appeal_number, client_name, phone, city, detailed_address, address, place_id, dialog, note, deadline, deadline_time, salemanager, type";

/** Карусель с нуля: пинги считаются заново, заявка снова «ни разу не отложена». */
const ROTATION_RESET = {
  deadline_reminder_count: 0,
  deadline_snoozed_until: null,
  deadline_snoozed_at: null,
};

/** Заявка уходит из очереди пингов: карточка и пинг забыты, карусель с нуля. */
const QUEUE_RESET = {
  deadline_notif_sent_at: null,
  deadline_notif_tg_msg_id: null,
  deadline_reminder_tg_msg_id: null,
  ...ROTATION_RESET,
};

/**
 * Возвращает дату «сегодня» по московскому времени в формате YYYY-MM-DD.
 */
function getMskTodayDate() {
  return mskDate();
}

/**
 * Текущее время MSK как HH:mm.
 */
function getMskNowTime() {
  return mskClock();
}

/**
 * Поле времени дедлайна для записи: undefined — время не трогаем,
 * null или пусто — очищаем, строка — пишем как HH:mm:00 по Москве.
 */
function deadlineTimePatch(newTime) {
  if (newTime === undefined) return {};
  const normalized = normalizeDeadlineTime(newTime);
  return { deadline_time: normalized ? `${normalized}:00` : null };
}

/**
 * Дедлайн уже наступил по MSK?
 * deadline < сегодня → да; deadline > сегодня → нет;
 * deadline = сегодня → deadline_time <= сейчас (NULL time = с начала дня).
 *
 * @param {{ deadline?: string|null, deadline_time?: string|null }} event
 * @param {string} [today]
 * @param {string} [nowTime]
 */
function isDeadlineDue(event, today = getMskTodayDate(), nowTime = getMskNowTime()) {
  if (!event?.deadline) return false;
  if (event.deadline < today) return true;
  if (event.deadline > today) return false;
  const t = normalizeDeadlineTime(event.deadline_time);
  if (!t) return true;
  return t <= nowTime;
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
 * Есть ли событие погрузки, по которому бот уже кинул карточку, а менеджер
 * ещё не сменил дедлайн (notif_* не сброшены) — и дедлайн всё ещё due.
 *
 * Важно: фильтр deadline <= сегодня (как в getNextDeadlineEvent), а не == сегодня.
 * Иначе просроченная карточка «выпадает» из активных после полуночи / при overdue,
 * и воркер начинает слать новые заявки вместо ⏰-пинга.
 *
 * @returns {Promise<object|null>}
 */
async function getActiveDeadlineNotif({ neverSnoozedOnly = false } = {}) {
  const today = getMskTodayDate();

  let query = supabase
    .from("eventsnew")
    .select(
      "id, appeal_number, deadline, deadline_time, deadline_notif_sent_at, deadline_notif_tg_msg_id, deadline_reminder_tg_msg_id, deadline_reminder_count, deadline_snoozed_until, deadline_snoozed_at",
    )
    .eq("type", "Погрузка")
    .lte("deadline", today)
    .not("deadline_notif_sent_at", "is", null);

  if (neverSnoozedOnly) {
    // Полоса «ещё ни разу не откладывали» — она идёт раньше висяков без карточки.
    query = query.is("deadline_snoozed_at", null);
  } else {
    // Вернувшиеся из отложенных: те, у кого срок молчания истёк.
    query = query.or(`deadline_snoozed_until.is.null,deadline_snoozed_until.lte.${today}`);
  }

  const { data, error } = await query
    // Кого отложили раньше — тот раньше и вернётся: круг, а не «вечно самая старая».
    .order("deadline_snoozed_at", { ascending: true, nullsFirst: true })
    .order("deadline", { ascending: true })
    .order("deadline_time", { ascending: true, nullsFirst: true })
    .order("deadline_notif_sent_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("[loading-deadlines/queries] getActiveDeadlineNotif:", error.message);
    throw error;
  }

  const rows = data || [];
  // Самая ранняя due-карточка блокирует очередь; пинги только по ней.
  return rows.find((row) => isDeadlineDue(row)) || null;
}

/**
 * Следующее событие из очереди:
 * type=Погрузка, deadline <= сегодня MSK, время уже наступило, notif не отправляли.
 *
 * @returns {Promise<object|null>}
 */
async function getNextDeadlineEvent({ notEarlierThan = null } = {}) {
  const today = getMskTodayDate();

  let query = supabase
    .from("eventsnew")
    .select(EVENT_CARD_SELECT)
    .eq("type", "Погрузка")
    .lte("deadline", today)
    .is("deadline_notif_sent_at", null);

  // Свежая полоса: заявки с недавним дедлайном показываем, не дожидаясь висяков.
  if (notEarlierThan) query = query.gte("deadline", notEarlierThan);

  const { data, error } = await query
    .order("deadline", { ascending: true })
    .order("deadline_time", { ascending: true, nullsFirst: true })
    .order("id", { ascending: false })
    .limit(25);

  if (error) {
    console.error("[loading-deadlines/queries] getNextDeadlineEvent:", error.message);
    throw error;
  }

  const rows = data || [];
  return rows.find((row) => isDeadlineDue(row)) || null;
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
      ...ROTATION_RESET,
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
 * Перенос дедлайна погрузки: новая дата (+ опц. время) + сброс трекинга уведомлений.
 *
 * @param {number} id
 * @param {string} newDate YYYY-MM-DD
 * @param {string|null|undefined} newTime HH:mm — если undefined, время не трогаем;
 *   если null — очищаем; если строка — пишем MSK wall-clock.
 */
async function rescheduleLoadingDeadline(id, newDate, newTime) {
  const updatePayload = {
    deadline: newDate,
    ...QUEUE_RESET,
    ...deadlineTimePatch(newTime),
  };

  const { error } = await supabase.from("eventsnew").update(updatePayload).eq("id", id);

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
 * @param {{ fieldPatch?: object, dialogAppend?: string | null, newTime?: string|null }} payload
 */
async function applyInfoAddedAndRescheduleLoading(
  id,
  newDate,
  { fieldPatch = {}, dialogAppend = null, newTime } = {},
) {
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
    ...QUEUE_RESET,
    ...deadlineTimePatch(newTime),
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
 * Событие погрузки по внутреннему id — для кнопок под карточкой: в кнопке
 * лежит id, а не номер заявки (номер может повторяться у повторных обращений).
 *
 * @param {number} id
 * @returns {Promise<object|null>}
 */
async function findLoadingEventById(id) {
  const { data, error } = await supabase
    .from("eventsnew")
    .select(
      `${EVENT_CARD_SELECT}, deadline_notif_sent_at, deadline_notif_tg_msg_id, deadline_reminder_tg_msg_id`,
    )
    .eq("type", "Погрузка")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[loading-deadlines/queries] findLoadingEventById:", error.message);
    throw error;
  }

  return data || null;
}

/**
 * Погрузки без дедлайна — для бота их не существует, пока дату не поставят.
 * Новые сверху: свежая заявка — горячий клиент.
 *
 * @param {number} limit
 * @returns {Promise<{ events: object[], count: number }>}
 */
async function listLoadingWithoutDeadline(limit) {
  const { data, error, count } = await supabase
    .from("eventsnew")
    .select(`${EVENT_CARD_SELECT}, created_at`, { count: "exact" })
    .eq("type", "Погрузка")
    .is("deadline", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[loading-deadlines/queries] listLoadingWithoutDeadline:", error.message);
    throw error;
  }

  return { events: data || [], count: count ?? 0 };
}

/**
 * Данные утренней сводки: на сегодня, без дедлайна, просрочено.
 *
 * @param {{ todayLimit: number, withoutLimit: number }} limits
 */
async function getDailyDigestData({ todayLimit, withoutLimit }) {
  const today = getMskTodayDate();

  const todayQuery = supabase
    .from("eventsnew")
    .select("appeal_number, city, deadline_time", { count: "exact" })
    .eq("type", "Погрузка")
    .eq("deadline", today)
    .order("deadline_time", { ascending: true, nullsFirst: true })
    .order("id", { ascending: false })
    .limit(todayLimit);

  const overdueQuery = supabase
    .from("eventsnew")
    .select("deadline", { count: "exact" })
    .eq("type", "Погрузка")
    .lt("deadline", today)
    .order("deadline", { ascending: true })
    .limit(1);

  const [todayRes, overdueRes, without] = await Promise.all([
    todayQuery,
    overdueQuery,
    listLoadingWithoutDeadline(withoutLimit),
  ]);

  for (const res of [todayRes, overdueRes]) {
    if (res.error) {
      console.error("[loading-deadlines/queries] getDailyDigestData:", res.error.message);
      throw res.error;
    }
  }

  return {
    today,
    onToday: { events: todayRes.data || [], count: todayRes.count ?? 0 },
    withoutDeadline: without,
    overdue: {
      count: overdueRes.count ?? 0,
      oldestDeadline: overdueRes.data?.[0]?.deadline ?? null,
    },
  };
}

/**
 * Записывает, что по событию ушёл очередной ⏰-пинг.
 *
 * @param {number} id
 * @param {number} sentCount — сколько пингов стало (прежнее значение + 1)
 */
async function setDeadlineReminderCount(id, sentCount) {
  const { error } = await supabase
    .from("eventsnew")
    .update({ deadline_reminder_count: sentCount })
    .eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] setDeadlineReminderCount:", error.message);
    throw error;
  }
}

/**
 * Откладывает событие до указанной даты: пинги по нему прекращаются, очередь
 * берёт следующее. Заявка остаётся в очереди — вернётся, когда дата наступит,
 * и встанет позади тех, кого ещё не показывали.
 *
 * @param {number} id
 * @param {string} untilDate YYYY-MM-DD (MSK)
 */
async function snoozeDeadlineEvent(id, untilDate) {
  const { error } = await supabase
    .from("eventsnew")
    .update({
      ...ROTATION_RESET,
      deadline_snoozed_until: untilDate,
      deadline_snoozed_at: new Date().toISOString(),
      deadline_reminder_tg_msg_id: null,
    })
    .eq("id", id);

  if (error) {
    console.error("[loading-deadlines/queries] snoozeDeadlineEvent:", error.message);
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
    .select(EVENT_CARD_SELECT, { count: "exact" })
    .eq("type", "Погрузка")
    .not("deadline", "is", null);

  if (mode === "urgent") {
    const today = getMskTodayDate();
    q = q
      .lte("deadline", today)
      .order("deadline", { ascending: true })
      .order("deadline_time", { ascending: true, nullsFirst: true })
      .order("id", { ascending: false });
  } else if (mode === "recent_past") {
    // N ближайших к сегодня, но строго раньше сегодня (не угадывать «вчера»).
    const today = getMskTodayDate();
    q = q
      .lt("deadline", today)
      .order("deadline", { ascending: false })
      .order("deadline_time", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
  } else {
    q = q
      .eq("deadline", date)
      .order("deadline_time", { ascending: true, nullsFirst: true })
      .order("id", { ascending: false });
  }

  const { data, error, count } = await q.limit(fetchLimit);

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
    // Точное число совпадений — кнопки сводки пишут «10 из 13», а не молча режут список.
    totalMatched: count ?? events.length,
  };
}

module.exports = {
  getMskTodayDate,
  getMskNowTime,
  getMskDateOffset,
  validateNewDeadlineDate,
  getActiveDeadlineNotif,
  getNextDeadlineEvent,
  markDeadlineNotifSent,
  updateDeadlineReminderMsgId,
  setDeadlineReminderCount,
  snoozeDeadlineEvent,
  findLoadingEventByNumber,
  findLoadingEventById,
  listLoadingWithoutDeadline,
  getDailyDigestData,
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
