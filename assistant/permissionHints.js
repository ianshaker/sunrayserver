// ============================================================================
// Подсказки: похоже ли сообщение на создание / управление задачей,
// и какой ответ дать, если в чате нет нужного permission.
// ============================================================================

const { PERMISSIONS } = require("../lib/telegramBotChats");

const MANAGE_HINT =
  /(?:измен|перенес|перенос|перенест|отмен|заверш|удал|закрой|сотри|edit|reschedule|задач[ауеё]\s*#?\s*\d+|напоминани[ея]\s*(?:номер|#)?\s*\d+|номер\s*\d+.*(?:время|перенес|измен))/i;

const CREATE_HINT =
  /(?:напомн|создай|поставь\s+задач|не\s+забуд|заведи\s+задач|сделай\s+напомин)/i;

function looksLikeManage(text) {
  return MANAGE_HINT.test(String(text || ""));
}

function looksLikeCreate(text) {
  return CREATE_HINT.test(String(text || ""));
}

function routerReasonImpliesManage(reason) {
  const r = String(reason || "").toLowerCase();
  return (
    r.includes("изменен") ||
    r.includes("изменить") ||
    r.includes("существующ") ||
    r.includes("перенос") ||
    r.includes("управлен")
  );
}

function chatHasPermission(chat, permission) {
  return Array.isArray(chat?.permissions) && chat.permissions.includes(permission);
}

/**
 * @returns {"no_registry"|"no_permissions"|"no_create"|"no_manage"|null}
 */
function detectPermissionGap({ chat, text, classification, contextReason }) {
  if (contextReason?.startsWith("chat_not_in_registry")) {
    return "no_registry";
  }
  if (contextReason === "no_enabled_intents") {
    return "no_permissions";
  }

  if (!chat) return null;

  const hasCreate = chatHasPermission(chat, PERMISSIONS.TASK_CREATE);
  const hasManage = chatHasPermission(chat, PERMISSIONS.TASK_ACTIONS);

  const wantsManage =
    looksLikeManage(text) ||
    (classification?.intent === "unknown" && routerReasonImpliesManage(classification.reason));

  const wantsCreate = looksLikeCreate(text);

  if (wantsManage && !hasManage) return "no_manage";
  if (wantsCreate && !hasCreate) return "no_create";

  return null;
}

module.exports = {
  looksLikeManage,
  looksLikeCreate,
  detectPermissionGap,
};
