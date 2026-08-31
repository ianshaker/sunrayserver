// ============================================================================
// yandexmail/imap/fetch — выборка писем. Только чтение, только заголовки,
// пока письмо не признано нужным.
//
// Порядок ровно такой: сначала дёшево забираем заголовки, решаем, наше ли это
// письмо, и только для нужных скачиваем целиком. Так чужая переписка не
// вычитывается зря, а трафик не тратится на рассылки.
// ============================================================================

/** Приводит адрес отправителя к простому виду: имя + почта. */
function formatAddress(list) {
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) return "";
  return first.address ? String(first.address).toLowerCase() : String(first.name || "");
}

/** Заголовок Message-ID в сравнимом виде: без скобок и регистра. */
function normalizeMessageId(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .toLowerCase();
}

function toHeaderRecord(message) {
  const envelope = message.envelope || {};
  return {
    uid: message.uid,
    date: envelope.date || message.internalDate || null,
    from: formatAddress(envelope.from),
    to: formatAddress(envelope.to),
    subject: envelope.subject || "",
    messageId: normalizeMessageId(envelope.messageId),
    size: message.size || 0,
    seen: Array.isArray(message.flags)
      ? message.flags.includes("\\Seen")
      : message.flags instanceof Set
        ? message.flags.has("\\Seen")
        : null,
  };
}

/** Поколение ящика и его размер: по ним ведётся закладка «докуда дочитали». */
function readMailboxState(client) {
  const mailbox = client.mailbox || {};
  return {
    path: mailbox.path,
    exists: mailbox.exists || 0,
    uidValidity: mailbox.uidValidity ? String(mailbox.uidValidity) : null,
    uidNext: mailbox.uidNext ? String(mailbox.uidNext) : null,
    readOnly: mailbox.readOnly === true,
  };
}

/**
 * Заголовки последних писем за N суток. Тело не трогаем.
 * @param {import("imapflow").ImapFlow} client
 * @param {{days?: number, limit?: number}} options
 */
async function fetchRecentHeaders(client, { days = 1, limit = 20 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const uids = await client.search({ since }, { uid: true });
  if (!uids || !uids.length) return [];

  const tail = uids.slice(-limit);
  const headers = [];
  for await (const message of client.fetch(
    tail,
    { uid: true, envelope: true, internalDate: true, size: true, flags: true },
    { uid: true },
  )) {
    headers.push(toHeaderRecord(message));
  }
  return headers.sort((a, b) => a.uid - b.uid);
}

/**
 * Заголовки писем, пришедших после известного номера. Основа догона:
 * длина простоя перестаёт иметь значение, потому что мы идём от закладки.
 * @param {import("imapflow").ImapFlow} client
 * @param {{lastUid: number, limit?: number}} options
 */
async function fetchHeadersAfterUid(client, { lastUid, limit = 200 } = {}) {
  const from = Number(lastUid || 0) + 1;
  const headers = [];
  for await (const message of client.fetch(
    `${from}:*`,
    { uid: true, envelope: true, internalDate: true, size: true, flags: true },
    { uid: true },
  )) {
    if (message.uid < from) continue; // сервер вправе вернуть последнее письмо, даже если новых нет
    headers.push(toHeaderRecord(message));
    if (headers.length >= limit) break;
  }
  return headers.sort((a, b) => a.uid - b.uid);
}

/**
 * Письмо целиком, как оно есть. Библиотека читает через BODY.PEEK,
 * поэтому отметка «прочитано» не ставится.
 * @returns {Promise<Buffer|null>}
 */
async function fetchRawSource(client, uid) {
  const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
  return message && message.source ? message.source : null;
}

module.exports = {
  normalizeMessageId,
  readMailboxState,
  fetchRecentHeaders,
  fetchHeadersAfterUid,
  fetchRawSource,
};
