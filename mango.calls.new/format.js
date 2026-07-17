const { MANAGERS, COMPANY_LINES, DISCONNECT_REASONS } = require("./constants");
const { entryCallMeta } = require("./state");

function formatPhoneNumber(phone) {
    if (!phone || typeof phone !== 'string') return 'Неизвестный номер';
    if (phone.includes('@')) return phone.replace('sip:', '').split('@')[0];
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
        return `8(${digits.substring(1, 4)})${digits.substring(4, 7)}-${digits.substring(7, 9)}-${digits.substring(9, 11)}`;
    }
    if (digits.length === 10) {
        return `8(${digits.substring(0, 3)})${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
    }
    return phone;
}

function getCompanyLineName(phone) {
    if (!phone) return 'Неизвестная линия';
    const digits = String(phone).replace(/\D/g, '');
    if (COMPANY_LINES[digits]) return `Линия сайта ${COMPANY_LINES[digits]}`;
    if (COMPANY_LINES[phone]) return `Линия сайта ${COMPANY_LINES[phone]}`;
    return `Линия ${formatPhoneNumber(phone)}`;
}

function resolveLineNumber(body, fallbackEntryId) {
    const fromIvr = fallbackEntryId && entryCallMeta[fallbackEntryId]?.lineNumber;
    return body.line_number
        || body.to?.line_number
        || body.from?.line_number
        || fromIvr
        || body.to?.number;
}

function getDisconnectLabel(code) {
    if (!code) return null;
    const n = Number(code);
    if (DISCONNECT_REASONS[n]) return DISCONNECT_REASONS[n];
    // Mango: подкод наследует описание класса (2219 → 2210, 1090 → 1000)
    const classCode = Math.floor(n / 10) * 10;
    if (DISCONNECT_REASONS[classCode]) return DISCONNECT_REASONS[classCode];
    const majorCode = Math.floor(n / 100) * 100;
    if (DISCONNECT_REASONS[majorCode]) return DISCONNECT_REASONS[majorCode];
    return `неизвестный код ${code}`;
}

function buildCallTiming(summary) {
    const create = summary.create_time || 0;
    const forward = summary.forward_time || 0;
    const talk = summary.talk_time || 0;
    const end = summary.end_time || 0;
    const answered = summary.entry_result === 1 && talk > 0;

    return {
        waitSeconds: forward && create ? Math.max(0, forward - create) : 0,
        ringSeconds: talk && forward ? Math.max(0, talk - forward) : 0,
        talkSeconds: talk && end ? Math.max(0, end - talk) : 0,
        totalSeconds: end && create ? Math.max(0, end - create) : 0,
        answered,
        missed: !answered,
    };
}

function getEventTimestamp(body) {
    return body.timestamp || 0;
}

function ensureLegTracking(callData) {
    if (!callData.managerLegs) callData.managerLegs = [];
    if (callData.currentLegIndex === undefined) callData.currentLegIndex = -1;
}

function closeCurrentManagerLeg(callData, endTimestamp, viaConnect = false) {
    ensureLegTracking(callData);
    const leg = callData.managerLegs[callData.currentLegIndex];
    if (!leg || leg.endedAt) return;

    leg.endedAt = endTimestamp;
    if (viaConnect && leg.connectedAt) {
        leg.ringSeconds = Math.max(0, leg.connectedAt - leg.appearedAt);
    } else {
        leg.ringSeconds = Math.max(0, endTimestamp - leg.appearedAt);
    }
}

function startManagerLeg(callData, managerName, timestamp, ivrPrepSeconds = null) {
    ensureLegTracking(callData);
    closeCurrentManagerLeg(callData, timestamp);

    let prepSeconds = 0;
    let prepLabel = 'Обработка АТС';
    const prev = callData.managerLegs[callData.currentLegIndex];

    if (prev?.endedAt) {
        prepSeconds = Math.max(0, timestamp - prev.endedAt);
        prepLabel = 'Переключение';
    } else if (ivrPrepSeconds !== null && ivrPrepSeconds > 0) {
        prepSeconds = ivrPrepSeconds;
        prepLabel = 'Обработка АТС';
    }

    callData.managerLegs.push({
        name: managerName,
        appearedAt: timestamp,
        prepSeconds,
        prepLabel,
        connectedAt: null,
        endedAt: null,
        ringSeconds: null,
        answered: false,
    });
    callData.currentLegIndex = callData.managerLegs.length - 1;
}

function markManagerLegConnected(callData, timestamp) {
    ensureLegTracking(callData);
    const leg = callData.managerLegs[callData.currentLegIndex];
    if (!leg) return;
    leg.connectedAt = timestamp;
    leg.answered = true;
}

function finalizeManagerLegs(callData, endTimestamp) {
    if (!callData.managerLegs?.length) return;
    const ts = endTimestamp || 0;
    if (ts > 0) closeCurrentManagerLeg(callData, ts);
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 сек';
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return min > 0 ? `${min}:${sec.toString().padStart(2, '0')} мин` : `${sec} сек`;
}

function formatManagerLegsBlock(managerLegs, acceptedManager) {
    if (!managerLegs?.length) return '';

    let block = '\n\n<b>Дозвон по менеджерам</b>';
    managerLegs.forEach((leg, i) => {
        block += `\n${i + 1}. <b>${leg.name}</b>`;
        if (leg.prepSeconds > 0) {
            block += `\n   ${leg.prepLabel}: ${formatDuration(leg.prepSeconds)}`;
        }
        if (leg.answered && acceptedManager === leg.name && leg.ringSeconds > 0) {
            block += `\n   Подняла трубку за: ${formatDuration(leg.ringSeconds)}`;
        } else if (leg.ringSeconds > 0) {
            block += `\n   Не ответила (звонили ${formatDuration(leg.ringSeconds)})`;
        } else if (!leg.answered) {
            block += `\n   Не ответила`;
        }
    });
    return block;
}

function formatCallStatusBlock(callData) {
    const { acceptedManager, timing, disconnectLabel, managerLegs } = callData;
    const hasLegs = managerLegs?.length > 0;
    let block = '';

    if (timing?.answered && acceptedManager) {
        block += `\n<b>Принят</b> — ${acceptedManager}`;
        if (!hasLegs) {
            if (timing.waitSeconds > 0) block += `\nОбработка АТС до звонка менеджеру: ${formatDuration(timing.waitSeconds)}`;
            if (timing.ringSeconds > 0) block += `\nМенеджер поднял трубку за: ${formatDuration(timing.ringSeconds)}`;
        }
        if (timing.talkSeconds > 0) block += `\nРазговор: ${formatDuration(timing.talkSeconds)}`;
        if (timing.totalSeconds > 0) block += `\nВсего: ${formatDuration(timing.totalSeconds)}`;
    } else {
        block += `\n<b>Пропущен</b>`;
        if (!hasLegs) {
            if (timing?.waitSeconds > 0) block += `\nОбработка АТС до звонка менеджеру: ${formatDuration(timing.waitSeconds)}`;
            if (timing?.ringSeconds > 0) block += `\nМенеджер не ответил (звонили ${formatDuration(timing.ringSeconds)})`;
        }
        if (timing?.totalSeconds > 0) block += `\nВсего: ${formatDuration(timing.totalSeconds)}`;
    }

    if (hasLegs) {
        block += formatManagerLegsBlock(managerLegs, acceptedManager);
    }

    if (disconnectLabel) block += `\nЗавершение: <b>${disconnectLabel}</b>`;
    return block;
}

function isManager(phone) {
    if (!phone) return false;
    let lookup = phone;
    if (phone.includes('@')) lookup = phone.replace('sip:', '');
    return MANAGERS[lookup] !== undefined;
}

function getManagerName(phone) {
    if (!phone) return 'Неизвестно';
    let lookup = phone;
    if (phone.includes('@')) lookup = phone.replace('sip:', '');
    return MANAGERS[lookup] || 'Неизвестно';
}

function isOutgoingCall(data) {
    if (data.call_direction === 2) return true;
    if (isManager(data.from?.number)) return true;
    return false;
}

module.exports = {
    formatPhoneNumber,
    getCompanyLineName,
    resolveLineNumber,
    getDisconnectLabel,
    buildCallTiming,
    getEventTimestamp,
    closeCurrentManagerLeg,
    startManagerLeg,
    markManagerLegConnected,
    finalizeManagerLegs,
    formatCallStatusBlock,
    formatManagerLegsBlock,
    isManager,
    getManagerName,
    isOutgoingCall,
    formatDuration,
};
