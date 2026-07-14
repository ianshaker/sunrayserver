// ============================================================================
// Возврат события погрузки во входящие — зеркало CRM
// unassignedEventsOperationsService.returnEventToAppeals.
//
// 1) INSERT appeals (status=Активно, source=Звонок, manager=Света)
// 2) DELETE eventsnew
// ============================================================================

const {
  findExistingAppealByNumber,
  insertAppealFromLoadingReturn,
  deleteLoadingEventById,
} = require("./queries");

/**
 * @param {object} event — строка eventsnew (type=Погрузка)
 */
function buildAppealRowFromLoading(event) {
  const returnText = `Возвращено из событий типа: ${event.type || "Погрузка"}`;
  const dialog = String(event.dialog || "").trim();
  const updatedDialog = dialog ? `${dialog}\n\n${returnText}` : returnText;

  return {
    appeal_number: event.appeal_number,
    client_name: event.client_name || "",
    phone: event.phone || "",
    city: event.city || "",
    address: event.address || "",
    detailed_address: event.detailed_address || "",
    dialog: updatedDialog,
    source: "Звонок",
    manager: "Света",
    product_type: "",
    status: "Активно",
    task_description: returnText,
  };
}

/**
 * Полный флоу возврата во входящие после подтверждения превью.
 *
 * @param {object} event
 */
async function executeLoadingReturnAppeals(event) {
  const appealNumber = event.appeal_number;
  if (!appealNumber) {
    const err = new Error("missing_appeal_number");
    throw err;
  }

  const existing = await findExistingAppealByNumber(appealNumber);
  if (existing) {
    const err = new Error("already_in_appeals");
    err.appealNumber = appealNumber;
    throw err;
  }

  const row = buildAppealRowFromLoading(event);
  await insertAppealFromLoadingReturn(row);
  await deleteLoadingEventById(event.id);

  console.log(
    `[loading-deadlines/returnAppeals] ✅ ${appealNumber} → appeals, eventsnew удалена`,
  );
  return {};
}

module.exports = {
  buildAppealRowFromLoading,
  executeLoadingReturnAppeals,
};
