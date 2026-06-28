/**
 * Принимает сырой ввод: код, URL редиректа Google или строку с code=...
 * Возвращает только OAuth code (например 4/0AdkVLPw...).
 */
function extractGoogleAuthCode(raw) {
  const input = String(raw || "").trim();
  if (!input) return "";

  // Полный URL или path с query (?code=...&scope=...)
  try {
    const base = input.includes("://") ? undefined : "http://local";
    const url = new URL(input, base);
    const fromQuery = url.searchParams.get("code");
    if (fromQuery) return fromQuery.trim();
  } catch (_) {
    /* fall through */
  }

  const queryMatch = input.match(/[?&]code=([^&\s#]+)/i);
  if (queryMatch) {
    try {
      return decodeURIComponent(queryMatch[1]).trim();
    } catch (_) {
      return queryMatch[1].trim();
    }
  }

  // Голый код 4/0A... — отрезаем хвост &scope= если скопировали криво
  if (/^4\//.test(input)) {
    return input.split(/[&\s#]/)[0].trim();
  }

  return input.split(/[&\s#]/)[0].trim();
}

module.exports = { extractGoogleAuthCode };
