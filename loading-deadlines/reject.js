// ============================================================================
// Отказ по событию погрузки — зеркало CRM unassignedEventsOperationsService.deleteEvent.
//
// 1) INSERT appealsotkaz
// 2) UPDATE ids.otkaz = 'отказ'
// 3) DELETE eventsnew
// ============================================================================

const {
  findExistingAppealsOtkaz,
  insertAppealsOtkaz,
  updateIdsOtkazFromLoading,
  deleteLoadingEventById,
} = require("./queries");

/**
 * @param {object} event — строка eventsnew (type=Погрузка)
 * @param {string|null|undefined} reason
 * @param {string|null|undefined} managerLabel
 */
function buildAppealsOtkazRow(event, reason, managerLabel) {
  const trimmedReason =
    String(reason || "").trim() || "Отказ из чата погрузки (Telegram)";

  return {
    appeal_number: event.appeal_number || "",
    client_name: event.client_name || "",
    phone: event.phone || "",
    city: event.city || "",
    address: event.address || "",
    detailed_address: event.detailed_address || "",
    dialog: event.dialog || "",
    source: "Система",
    manager: String(managerLabel || event.salemanager || "Система").trim() || "Система",
    reason: trimmedReason,
    status: "Отказ",
    product_type: event.type || "Погрузка",
    task_description: `Отказ из погрузки (Telegram): ${event.type || "Погрузка"}`,
  };
}

/**
 * Полный флоу отказа после подтверждения превью.
 *
 * @param {object} event
 * @param {string|null|undefined} reason
 * @param {string|null|undefined} managerLabel
 */
async function executeLoadingReject(event, reason, managerLabel) {
  const appealNumber = event.appeal_number;

  if (appealNumber) {
    const existing = await findExistingAppealsOtkaz(appealNumber);
    if (existing) {
      const err = new Error("already_rejected");
      err.appealNumber = appealNumber;
      throw err;
    }
  }

  const row = buildAppealsOtkazRow(event, reason, managerLabel);
  await insertAppealsOtkaz(row);
  await deleteLoadingEventById(event.id);

  if (appealNumber) {
    try {
      await updateIdsOtkazFromLoading(appealNumber);
    } catch (err) {
      // Как на фронте: ids не блокирует основной флоу.
      console.error(
        `[loading-deadlines/reject] ids update для ${appealNumber}:`,
        err.message,
      );
    }
  }

  console.log(
    `[loading-deadlines/reject] ✅ ${appealNumber || event.id} → appealsotkaz, eventsnew удалена`,
  );
  return {};
}

module.exports = {
  buildAppealsOtkazRow,
  executeLoadingReject,
};
