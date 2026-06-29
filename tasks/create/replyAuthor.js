// ============================================================================
// Автор отмеченного сообщения (reply) при создании задачи.
// Если профиль найден в БД — co-assignee; иначе — строка в description.
// ============================================================================

const { resolveProfileIdByTelegramUser, normalizeUsername } = require("../directory");
const { getRoster } = require("./assigneeRoster");

function formatUnknownReplyAuthor(from) {
  if (!from) return null;
  const uname = normalizeUsername(from.username);
  if (uname) return `@${uname}`;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * @param {import('node-telegram-bot-api').User} from
 * @returns {Promise<{ profileId: string|null, profile: object|null, unknownLabel: string|null }>}
 */
async function resolveReplyAuthor(from) {
  if (!from || from.is_bot) {
    return { profileId: null, profile: null, unknownLabel: null };
  }

  const profileId = await resolveProfileIdByTelegramUser(from);
  if (profileId) {
    const roster = await getRoster();
    const profile = roster.find((p) => p.id === profileId) || null;
    return { profileId, profile, unknownLabel: null };
  }

  return {
    profileId: null,
    profile: null,
    unknownLabel: formatUnknownReplyAuthor(from),
  };
}

/** co-assignee ids: автор отметки первым, затем из Gemini (без дублей). */
function mergeCoAssigneeIds(replyAssigneeId, geminiExtraId) {
  const ids = [];
  if (replyAssigneeId) ids.push(replyAssigneeId);
  if (geminiExtraId && geminiExtraId !== replyAssigneeId) ids.push(geminiExtraId);
  return ids;
}

function appendReplyAuthorNote(description, unknownLabel) {
  if (!unknownLabel) return description || "";
  const note = `Отмеченное сообщение от ${unknownLabel}`;
  const base = (description || "").trim();
  if (base.toLowerCase().includes(unknownLabel.toLowerCase())) return base;
  return base ? `${base}\n${note}` : note;
}

module.exports = {
  resolveReplyAuthor,
  mergeCoAssigneeIds,
  appendReplyAuthorNote,
  formatUnknownReplyAuthor,
};
