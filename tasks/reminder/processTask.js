const { getChatIdForUserSync, ensureDirectory } = require("../directory");
const { resolveAssigneeIds } = require("../assignees");
const { loadProfilesByIds } = require("../profiles");
const { buildTaskDueReminderMessage } = require("../messages");
const { sendTaskTelegramMessage } = require("../telegram");
const { buildTaskActionKeyboard } = require("../keyboards");
const {
  appendReminderToDescription,
} = require("./descriptionLog");
const { claimTaskForReminder, updateTaskDescription } = require("./queries");

async function processTaskReminder(task, telegramBot) {
  const assigneeIds = resolveAssigneeIds(task);
  if (!assigneeIds.length) {
    console.warn(`[tasks/reminder] нет исполнителей у задачи ${task.id}`);
    return { sent: false };
  }

  const profiles = await loadProfilesByIds(assigneeIds);
  await ensureDirectory();
  const reachableIds = assigneeIds.filter((id) => getChatIdForUserSync(id));

  if (!reachableIds.length) {
    const names = assigneeIds
      .map((id) => profiles.get(id)?.full_name || id)
      .join(", ");
    console.log(
      `[tasks/reminder] некому слать «${task.title}» — нет chat_id: ${names}`,
    );
    return { sent: false };
  }

  const claimed = await claimTaskForReminder(task.id);
  if (!claimed) return { sent: false };

  const sentAt = claimed.due_reminder_sent_at || new Date().toISOString();
  let sentCount = 0;

  for (const userId of reachableIds) {
    const profile = profiles.get(userId);
    const fullName = profile?.full_name || userId;
    const chatId = getChatIdForUserSync(userId);

    if (!chatId) {
      console.log(
        `[tasks/reminder] нет Telegram chat_id для ${fullName} (${userId})`,
      );
      continue;
    }

    const message = buildTaskDueReminderMessage(claimed, profile);
    const keyboard = buildTaskActionKeyboard(claimed.task_number);

    // Если задача создана из этого же чата — напоминание reply на отбивку.
    const extraOptions = {};
    if (
      claimed.tg_message_id &&
      claimed.tg_chat_id != null &&
      Number(claimed.tg_chat_id) === Number(chatId)
    ) {
      extraOptions.reply_to_message_id = Number(claimed.tg_message_id);
      extraOptions.allow_sending_without_reply = true;
    }

    try {
      await sendTaskTelegramMessage(telegramBot, chatId, message, keyboard, extraOptions);
      sentCount += 1;
      console.log(
        `[tasks/reminder] «${claimed.title}» → ${fullName} (chat ${chatId})`,
      );
    } catch (error) {
      console.error(
        `[tasks/reminder] ошибка TG для ${fullName}:`,
        error.message,
      );
    }
  }

  const newDescription = appendReminderToDescription(
    claimed.description,
    sentAt,
  );
  await updateTaskDescription(claimed.id, newDescription);

  return { sent: true, sentCount };
}

module.exports = { processTaskReminder };
