// ============================================================================
// Черновики действий по дедлайну входящей (между превью и «Сохранить»).
// ============================================================================

const crypto = require("crypto");
const { DRAFT_TTL_MS } = require("./config");

const drafts = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, draft] of drafts) {
    if (draft.expiresAt <= now) drafts.delete(id);
  }
}

/**
 * @param {{
 *   chatId: number,
 *   authorProfileId: string,
 *   action: "reschedule" | "info_added",
 *   appealId: number,
 *   appealNumber: string,
 *   clientName?: string | null,
 *   currentReminderDate?: string | null,
 *   newDate: string,
 *   newDateHuman: string,
 *   infoText?: string | null,
 *   dialogAppend?: string | null,
 *   managerLabel?: string | null,
 * }} data
 * @returns {string}
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

function takeDraft(id) {
  const draft = getDraft(id);
  if (draft) drafts.delete(id);
  return draft;
}

module.exports = { createDraft, getDraft, takeDraft };
