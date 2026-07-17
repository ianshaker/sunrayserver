const activeCalls = {}; // call_id: инфо о звонке
const entryCallMeta = {}; // entry_id: данные с этапа IVR (номер линии до дозвона)

// Одна живая карточка на номер: { card, callData, foundInfoList, createdAppealId, crmPhase, errorNote, finished }
const callMessages = {};

module.exports = { activeCalls, entryCallMeta, callMessages };
