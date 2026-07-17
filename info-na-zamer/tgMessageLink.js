// ============================================================================
// Сборка / разбор deep-link карточки события в супергруппе мастера.
// Канон: https://t.me/c/1962103813/6113  (chat API -1001962103813, msg 6113)
// ============================================================================

/**
 * @param {number|string|null|undefined} chatId  Telegram chat_id (-100…)
 * @param {number|string|null|undefined} messageId
 * @returns {string|null}
 */
function buildTgMessageLink(chatId, messageId) {
  if (chatId == null || messageId == null || messageId === "") return null;
  const chatNum = Number(chatId);
  const msgNum = Number(messageId);
  if (!Number.isFinite(chatNum) || !Number.isFinite(msgNum) || msgNum <= 0) {
    return null;
  }

  let internalId;
  const abs = String(Math.abs(chatNum));
  if (abs.startsWith("100") && abs.length > 3) {
    internalId = abs.slice(3);
  } else {
    internalId = abs;
  }
  if (!/^\d+$/.test(internalId)) return null;

  return `https://t.me/c/${internalId}/${msgNum}`;
}

/**
 * @param {string|null|undefined} raw
 * @returns {{ link: string, chatId: number, messageId: number } | null}
 */
function parseTgMessageLink(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/^<|>$/g, "");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;

  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") return null;

  // /c/{internalId}/{messageId}  optional trailing /thread
  const m = url.pathname.match(/^\/c\/(\d+)\/(\d+)(?:\/\d+)?\/?$/);
  if (!m) return null;

  const internalId = m[1];
  const messageId = parseInt(m[2], 10);
  if (!Number.isFinite(messageId) || messageId <= 0) return null;

  const chatId = -Number(`100${internalId}`);
  const link = `https://t.me/c/${internalId}/${messageId}`;
  return { link, chatId, messageId };
}

module.exports = {
  buildTgMessageLink,
  parseTgMessageLink,
};
