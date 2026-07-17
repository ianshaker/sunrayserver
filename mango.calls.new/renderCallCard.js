const { formatCallStatusBlock, formatManagerLegsBlock } = require("./format");
const { buildFoundInfoMessage } = require("./crmLookup");
const { TELEGRAM_MAX } = require("./callCard");

function historyWord(n) {
  return n === 1 ? "запись" : n < 5 ? "записи" : "записей";
}

function buildCrmSection(session, maxFound) {
  const phone = session.callData?.formattedFromNumber;
  const found = session.foundInfoList || [];
  const show = found.slice(0, maxFound);
  const omitted = found.length - show.length;

  if (session.crmPhase === "searching") {
    return `\n\n🔍 Ищу <b>${phone}</b> по базам данных...`;
  }

  if (show.length > 0) {
    const n = found.length;
    let block = `\n\n📋 <b>История клиента (${n} ${historyWord(n)})</b>\n`;
    for (const found of show) {
      block += `\n` + buildFoundInfoMessage(found);
    }
    if (omitted > 0) {
      block += `\n\n<i>…ещё ${omitted} ${historyWord(omitted)}</i>`;
    }
    return block;
  }

  if (session.crmPhase === "creating_appeal") {
    return `\n\n📝 По номеру <b>${phone}</b> ничего не нашёл. Создаю новую заявку...`;
  }

  if (session.createdAppealId) {
    return (
      `\n\n📋 <b>Создана новая заявка</b>\n` +
      `Номер заявки: <b>${session.createdAppealId}</b>`
    );
  }

  if (session.errorNote) {
    return `\n\n❌ <b>Ошибка</b>\n${session.errorNote}`;
  }

  if (session.finished && session.callData?.timing?.missed) {
    return `\n\n<i>Клиент не найден в базе, заявка не создавалась</i>`;
  }

  return "";
}

function buildCardHtml(session, maxFound) {
  const callData = session.callData || {};
  const { formattedFromNumber, lineName, managers } = callData;
  const finished = !!session.finished;

  let msg = finished
    ? `📞 <b>ЗАВЕРШЁННЫЙ ЗВОНОК</b>\n`
    : `📞 <b>ВХОДЯЩИЙ ЗВОНОК</b>\n`;

  msg += `Абонент: <b>${formattedFromNumber}</b>\n`;
  msg += `${lineName || ""}\n`;

  if (managers?.length === 1) {
    msg += `Маршрут: <b>${managers[0]}</b>`;
  } else if (managers?.length > 1) {
    msg += `Маршрут: <b>${managers.join(" → ")}</b>`;
  }

  if (finished) {
    msg += formatCallStatusBlock(callData);
  } else {
    if (callData.acceptedManager) {
      msg += `\n✅ <b>Принят</b> — ${callData.acceptedManager}`;
      msg += `\n<i>Жду завершения разговора…</i>`;
    } else if (managers?.length) {
      msg += `\nЗвонок менеджеру: <b>${managers[managers.length - 1]}</b>`;
    }

    if (callData.managerLegs?.length) {
      msg += formatManagerLegsBlock(callData.managerLegs, callData.acceptedManager);
    }
  }

  msg += buildCrmSection(session, maxFound);
  return msg;
}

/**
 * Полный HTML карточки звонка (live или final).
 * session: { callData, foundInfoList, createdAppealId, crmPhase, errorNote, finished }
 */
function renderCallCard(session) {
  const total = session.foundInfoList?.length || 0;
  let maxFound = total;

  for (;;) {
    const text = buildCardHtml(session, maxFound);
    if (text.length <= TELEGRAM_MAX) return text;
    if (maxFound > 0) {
      maxFound -= 1;
      continue;
    }
    return text.slice(0, TELEGRAM_MAX - 1) + "…";
  }
}

module.exports = { renderCallCard };
