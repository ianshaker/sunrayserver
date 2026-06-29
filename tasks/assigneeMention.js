// Упоминание исполнителя в Telegram: @username или tg://user?id= (HTML).

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeUsername(value) {
  if (!value) return null;
  const clean = String(value).replace(/^@/, "").trim();
  return clean || null;
}

/**
 * @param {{ full_name?: string|null, telegram_username?: string|null, telegram_user_id?: number|string|null }} profile
 * @returns {{ text: string, parseMode?: string }}
 */
function buildAssigneeMention(profile) {
  if (!profile) return { text: "—" };

  const name = profile.full_name?.trim() || "—";
  const username = normalizeUsername(profile.telegram_username);

  if (username) {
    return { text: `${name} @${username}` };
  }

  const tgUserId =
    profile.telegram_user_id != null ? Number(profile.telegram_user_id) : null;
  if (tgUserId) {
    return {
      text: `<a href="tg://user?id=${tgUserId}">${escapeHtml(name)}</a>`,
      parseMode: "HTML",
    };
  }

  return { text: name };
}

function buildAssigneeLine(profile) {
  const mention = buildAssigneeMention(profile);
  return {
    text: `Исполнитель: ${mention.text}`,
    parseMode: mention.parseMode,
  };
}

function buildForLine(profile) {
  const mention = buildAssigneeMention(profile);
  return {
    text: `Для: ${mention.text}`,
    parseMode: mention.parseMode,
  };
}

/** «Для: Гена, Ян @username» — все исполнители, HTML если нужен tg://user. */
function buildForLineMultiple(profiles) {
  const list = (profiles || []).filter(Boolean);
  if (!list.length) return { text: "Для: —" };

  const mentions = list.map((p) => buildAssigneeMention(p));
  const parseMode = mentions.some((m) => m.parseMode === "HTML") ? "HTML" : undefined;

  return {
    text: `Для: ${mentions.map((m) => m.text).join(", ")}`,
    parseMode,
  };
}

function buildAddAssigneeLine(profile) {
  const mention = buildAssigneeMention(profile);
  return {
    text: `Добавить исполнителя: ${mention.text}`,
    parseMode: mention.parseMode,
  };
}

function buildAddedAssigneeLine(profile) {
  const mention = buildAssigneeMention(profile);
  return {
    text: `Добавлен: ${mention.text}`,
    parseMode: mention.parseMode,
  };
}

function buildAssigneesLine(profiles) {
  const line = buildForLineMultiple(profiles);
  return {
    text: line.text.replace(/^Для:/, "Исполнители:"),
    parseMode: line.parseMode,
  };
}

module.exports = {
  buildAssigneeMention,
  buildAssigneeLine,
  buildAssigneesLine,
  buildForLine,
  buildForLineMultiple,
  buildAddAssigneeLine,
  buildAddedAssigneeLine,
};
