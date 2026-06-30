// ============================================================================
// Отказ по входящей заявке (зеркало CRM useRejectAppealModal).
// ============================================================================

const {
  findExistingReject,
  insertAppealsOtkaz,
  deleteAppealById,
  updateIdsOtkaz,
} = require("./queries");

/**
 * @param {object} appeal — строка appeals
 * @param {string|null|undefined} reason
 */
function buildAppealsOtkazRow(appeal, reason) {
  const trimmedReason = String(reason || "").trim() || null;

  return {
    appeal_number: appeal.appeal_number,
    client_name: appeal.client_name || "",
    phone: appeal.phone || "",
    city: appeal.city || "",
    address: appeal.address || "",
    detailed_address: appeal.detailed_address || null,
    source: appeal.source || "",
    product_type: appeal.product_type || null,
    manager: appeal.manager || "",
    status: appeal.status || "отказано",
    dialog: appeal.dialog || null,
    reminder_date: appeal.reminder_date || null,
    reminder_time: appeal.reminder_time || null,
    task_description: appeal.task_description || null,
    reason: trimmedReason,
  };
}

/**
 * Полный флоу отказа после подтверждения превью.
 *
 * @param {object} appeal
 * @param {string|null|undefined} reason
 */
async function executeAppealReject(appeal, reason) {
  const appealNumber = appeal.appeal_number;

  const existing = await findExistingReject(appealNumber);
  if (existing) {
    const err = new Error("already_rejected");
    err.appealNumber = appealNumber;
    throw err;
  }

  const row = buildAppealsOtkazRow(appeal, reason);
  await insertAppealsOtkaz(row);
  await deleteAppealById(appeal.id);
  await updateIdsOtkaz(appealNumber);

  console.log(`[appeals-deadlines/reject] ✅ ${appealNumber} → appealsotkaz, appeals удалена`);
  return {};
}

module.exports = {
  buildAppealsOtkazRow,
  executeAppealReject,
};
