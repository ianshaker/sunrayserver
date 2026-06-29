// ============================================================================
// Отмеченное сообщение (reply) при управлении задачей:
// контекст для парсера / поиска + дополнение описания + исполнитель.
// ============================================================================

const {
  resolveReplyAuthor,
  appendReplyAuthorNote,
} = require("../create/replyAuthor");

function mergeDescriptionAppend(existing, addition) {
  const add = (addition || "").trim();
  if (!add) return existing || null;
  const base = (existing || "").trim();
  if (!base) return add;
  const snippet = add.slice(0, 40);
  if (snippet && base.includes(snippet)) return base;
  return `${base}\n${add}`;
}

function hasEditChanges(parsed) {
  return !!(parsed.dueDateUtc || parsed.extraAssigneeId || parsed.descriptionAppend);
}

/**
 * После parseManageMessage: replyText → description_append, reschedule → edit при необходимости.
 * replyFrom → extra_assignee (edit) или пометка в описании.
 *
 * @param {object} parsed — результат parseManageMessage
 * @param {{ replyText?: string|null, replyFrom?: object|null }} opts
 */
async function applyReplyContext(parsed, { replyText, replyFrom } = {}) {
  if (!parsed) return parsed;

  const text = (replyText || "").trim();
  if (!text && !replyFrom) return parsed;

  let next = { ...parsed };

  if (text) {
    if (next.status === "ok" && next.action === "reschedule") {
      next = {
        ...next,
        action: "edit",
        descriptionAppend: text,
      };
      console.log("[tasks/manage] replyCtx → reschedule+reply → edit с доп. описанием");
    } else if (next.action === "edit") {
      const merged = mergeDescriptionAppend(next.descriptionAppend, text);
      if (merged !== next.descriptionAppend) {
        next.descriptionAppend = merged;
        if (next.status === "rejected" && next.taskNumber != null) {
          next.status = "ok";
          next.reason = undefined;
          console.log("[tasks/manage] replyCtx → salvage edit из отмеченного сообщения");
        }
      }
    }
  }

  if (replyFrom && text && next.action === "edit") {
    const { profileId, unknownLabel } = await resolveReplyAuthor(replyFrom);
    if (profileId && !next.extraAssigneeId) {
      next.extraAssigneeId = profileId;
      if (next.status === "rejected" && next.taskNumber != null && (text || profileId)) {
        next.status = "ok";
        next.reason = undefined;
      }
      console.log(`[tasks/manage] replyAuthor → extra assignee ${profileId}`);
    } else if (unknownLabel) {
      next.descriptionAppend = appendReplyAuthorNote(next.descriptionAppend, unknownLabel);
      if (next.status === "rejected" && next.taskNumber != null) {
        next.status = "ok";
        next.reason = undefined;
      }
    }
  }

  if (next.action === "edit" && next.status === "ok" && !hasEditChanges(next)) {
    return {
      ...next,
      status: "rejected",
      reason: "Не указано, что изменить в задаче.",
    };
  }

  return next;
}

module.exports = {
  applyReplyContext,
  mergeDescriptionAppend,
};
