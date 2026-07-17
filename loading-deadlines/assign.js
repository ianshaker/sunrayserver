// ============================================================================
// Назначение замера из погрузки — зеркало CRM useEventAssignment.
// Топливо → eventsnew → ids → salary → TG; откат при fail TG.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { getTelegramBot } = require("../tgwebhook/bot");
const { MASTER_CHAT_IDS } = require("../info-na-zamer/config");
const { buildClientCard } = require("../info-na-zamer/messages");
const { formatDate, formatTimeRange } = require("../info-na-zamer/format");
const { persistEventTgMessageLink } = require("../info-na-zamer/persistTgLink");
const { checkMasterAvailability } = require("./availability");
const { validateEventAddressForAssign } = require("./address");
const { insertFuelRecord, deleteFuelRecordByAppeal } = require("./fuel");
const { getTelegramMasterKey } = require("./masters");
const { findLoadingEventByNumber } = require("./queries");

const SALARY_TABLE = {
  Настя: "salary_nastya",
  Таня: "salary_tanya",
  Света: "salary_sveta",
  Гена: "salary_gena",
};

async function updateIdsMeasurement(appealNumber, master, date, startTime) {
  if (!appealNumber) return;
  const measurementDateTime = new Date(`${date}T${startTime}:00`);
  const { error } = await supabase
    .from("ids")
    .update({
      measurement_date: Number.isNaN(measurementDateTime.getTime())
        ? `${date}T${startTime}:00.000Z`
        : measurementDateTime.toISOString(),
      measurement_master: master,
    })
    .eq("appeal_id", appealNumber);

  if (error) {
    console.error("[loading-deadlines/assign] ids:", error.message);
  }
}

async function updateSalaryOnAssign(appealNumber, salemanager, measurementDate) {
  if (!appealNumber || !salemanager) return;
  const table = SALARY_TABLE[salemanager];
  if (!table) return;

  const updateData = {
    status: "на замере",
    comment: "Назначен замер",
    updated_at: new Date().toISOString(),
  };
  if (measurementDate) updateData.measurement_date = measurementDate;

  const { error } = await supabase
    .from(table)
    .update(updateData)
    .eq("appeal_id", appealNumber)
    .eq("status", "в погрузке");

  if (error) {
    console.error(`[loading-deadlines/assign] ${table}:`, error.message);
  } else {
    console.log(`[loading-deadlines/assign] salary ${table} → на замере ${appealNumber}`);
  }
}

async function sendZamerTelegram(event, { master, date, startTime, endTime, cleanAddress }) {
  const bot = getTelegramBot();
  if (!bot) throw new Error("telegram_bot_missing");

  const tgKey = getTelegramMasterKey(master);
  const chatId = tgKey ? MASTER_CHAT_IDS[tgKey] : null;
  if (chatId == null) throw new Error("master_chat_missing");

  const appealNumber = String(event.appeal_number || "").replace(/^#+/, "#");
  const msg = buildClientCard({
    appealNumber,
    clientName: event.client_name || "Без имени",
    phone: event.phone || "",
    city: event.city || "",
    address: cleanAddress,
    detailedAddress: event.detailed_address || undefined,
    dialog: event.dialog || undefined,
    masterName: master,
    formattedDate: formatDate(date),
    formattedTime: formatTimeRange(startTime, endTime),
    header: `ЗАЯВКА НА ЗАМЕР ${appealNumber}`.trim(),
  });

  const sent = await bot.sendMessage(chatId, msg);
  console.log(
    `[loading-deadlines/assign] TG → ${tgKey} chat=${chatId} msg_id=${sent?.message_id}`,
  );
  await persistEventTgMessageLink(event.id, chatId, sent?.message_id);
  return sent;
}

async function rollbackAssignment(eventId, master, appealNumber) {
  try {
    await supabase
      .from("eventsnew")
      .update({
        type: "Погрузка",
        master: null,
        date: null,
        start_time: null,
        end_time: null,
      })
      .eq("id", eventId);
  } catch (err) {
    console.error("[loading-deadlines/assign] rollback eventsnew:", err.message);
  }

  try {
    await deleteFuelRecordByAppeal(master, appealNumber);
  } catch (err) {
    console.error("[loading-deadlines/assign] rollback fuel:", err.message);
  }
}

/**
 * @param {{
 *   eventId: number,
 *   appealNumber: string,
 *   master: string,
 *   date: string,
 *   startTime: string,
 *   endTime: string,
 *   cleanAddress: string,
 *   placeId: string,
 * }} draft
 */
async function executeAssignZamer(draft) {
  const {
    eventId,
    appealNumber,
    master,
    date,
    startTime,
    endTime,
    cleanAddress,
    placeId,
  } = draft;

  let event = await findLoadingEventByNumber(appealNumber);
  if (!event || event.id !== eventId) {
    // id мог смениться — пробуем по id
    const { data, error } = await supabase
      .from("eventsnew")
      .select(
        "id, appeal_number, client_name, phone, city, detailed_address, address, place_id, dialog, note, deadline, salemanager, type",
      )
      .eq("id", eventId)
      .eq("type", "Погрузка")
      .maybeSingle();
    if (error || !data) {
      const err = new Error("event_not_found");
      throw err;
    }
    event = data;
  }

  const addr = validateEventAddressForAssign(event);
  if (!addr.ok) {
    const err = new Error("address_invalid");
    err.reason = addr.reason;
    throw err;
  }

  const availability = await checkMasterAvailability({
    master,
    date,
    startTime,
    endTime,
    excludeEventId: event.id,
  });
  if (availability.hasConflict) {
    const err = new Error("slot_busy");
    err.reason = availability.errorMessage;
    throw err;
  }

  await insertFuelRecord(master, {
    date,
    time: startTime,
    address: addr.cleanAddress || cleanAddress,
    place_id: addr.placeId || placeId,
    appeal_id: event.appeal_number || appealNumber,
  });

  const { error: updErr } = await supabase
    .from("eventsnew")
    .update({
      type: "Замер",
      master,
      date,
      start_time: startTime,
      end_time: endTime,
    })
    .eq("id", event.id);

  if (updErr) {
    await deleteFuelRecordByAppeal(master, event.appeal_number || appealNumber);
    console.error("[loading-deadlines/assign] eventsnew update:", updErr.message);
    throw updErr;
  }

  await updateIdsMeasurement(event.appeal_number || appealNumber, master, date, startTime);
  await updateSalaryOnAssign(event.appeal_number || appealNumber, event.salemanager, date);

  try {
    await sendZamerTelegram(event, {
      master,
      date,
      startTime,
      endTime,
      cleanAddress: addr.cleanAddress || cleanAddress,
    });
  } catch (tgErr) {
    console.error("[loading-deadlines/assign] TG fail:", tgErr.message);
    await rollbackAssignment(event.id, master, event.appeal_number || appealNumber);
    const err = new Error("telegram_failed");
    err.reason = tgErr.message;
    throw err;
  }

  console.log(
    `[loading-deadlines/assign] ✅ ${appealNumber} → Замер ${master} ${date} ${startTime}-${endTime}`,
  );
  return { ok: true };
}

module.exports = { executeAssignZamer };
