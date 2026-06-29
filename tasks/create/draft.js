// ============================================================================
// Черновики задач в памяти (между превью и нажатием «Сохранить»).
// Лёгкое решение без БД: при рестарте сервера черновик теряется (ок для v1).
// ============================================================================

const crypto = require("crypto");
const { DRAFT_TTL_MS } = require("./config");

const drafts = new Map(); // id → { ...data, expiresAt }

function sweep() {
  const now = Date.now();
  for (const [id, draft] of drafts) {
    if (draft.expiresAt <= now) drafts.delete(id);
  }
}

/**
 * @param {{ chatId:number, authorProfileId:string, title:string,
 *           description:string, dueDateUtc:string, dueDateHuman:string }} data
 * @returns {string} draftId
 */
function createDraft(data) {
  sweep();
  const id = crypto.randomBytes(6).toString("hex");
  drafts.set(id, { ...data, expiresAt: Date.now() + DRAFT_TTL_MS });
  return id;
}

function getDraft(id) {
  const draft = drafts.get(id);
  if (!draft) return null;
  if (draft.expiresAt <= Date.now()) {
    drafts.delete(id);
    return null;
  }
  return draft;
}

/** Достать и удалить (для одноразового подтверждения). */
function takeDraft(id) {
  const draft = getDraft(id);
  if (draft) drafts.delete(id);
  return draft;
}

module.exports = { createDraft, getDraft, takeDraft };
