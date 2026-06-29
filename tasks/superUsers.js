const { resolveAuthorizedUserIds } = require("./assignees");

/** Профили с правом действовать по любой задаче (TG-кнопки и будущие команды). */
const ELEVATED_BY_PROFILE_ID = {
  "2007764e-dae6-48e6-8a77-8978b00a3680": {
    roleLabel: "руководитель",
    noticeComplete:
      "Вы не автор и не исполнитель задачи, но как руководитель — действие выполнено.",
    noticeSnooze:
      "Вы не автор и не исполнитель задачи, но как руководитель — задача отложена.",
  },
  "28906cb8-fb15-40d1-9a8f-13ba4079e6b9": {
    roleLabel: "системный инженер",
    noticeComplete:
      "Вы не автор и не исполнитель задачи, но как системный инженер — действие выполнено.",
    noticeSnooze:
      "Вы не автор и не исполнитель задачи, но как системный инженер — задача отложена.",
  },
};

function isElevatedUser(profileId) {
  return Boolean(profileId && ELEVATED_BY_PROFILE_ID[profileId]);
}

function getElevatedAccess(profileId) {
  return ELEVATED_BY_PROFILE_ID[profileId] ?? null;
}

/**
 * @returns {{ allowed: boolean, elevated?: boolean, noticeComplete?: string, noticeSnooze?: string }}
 */
function resolveTaskActionPermission(task, profileId) {
  if (!profileId) return { allowed: false };

  const isParticipant = resolveAuthorizedUserIds(task).includes(profileId);
  if (isParticipant) return { allowed: true, elevated: false };

  const elevated = getElevatedAccess(profileId);
  if (elevated) {
    return {
      allowed: true,
      elevated: true,
      noticeComplete: elevated.noticeComplete,
      noticeSnooze: elevated.noticeSnooze,
    };
  }

  return { allowed: false };
}

module.exports = {
  isElevatedUser,
  getElevatedAccess,
  resolveTaskActionPermission,
};
