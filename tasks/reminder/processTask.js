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

  const originChatId =
    claimed.tg_chat_id != null ? Number(claimed.tg_chat_id) : null;
  const originMessageId =
    claimed.tg_message_id != null ? Number(claimed.tg_message_id) : null;

  // Задача из Telegram-бота: напоминание в тот же чат, reply на отбивку «✅ Создал задачу».
  if (originChatId && originMessageId) {
    const primaryId = claimed.assigned_to || reachableIds[0];
    const profile = profiles.get(primaryId);
    const fullName = profile?.full_name || primaryId;
    const reminder = buildTaskDueReminderMessage(claimed, profile);
    const keyboard = buildTaskActionKeyboard(claimed.task_number);

    try {
      await sendTaskTelegramMessage(telegramBot, originChatId, reminder.text, keyboard, {
        reply_to_message_id: originMessageId,
        allow_sending_without_reply: true,
        ...(reminder.parseMode ? { parse_mode: reminder.parseMode } : {}),
      });
      sentCount = 1;
      console.log(
        `[tasks/reminder] «${claimed.title}» → origin chat ${originChatId} ` +
          `(reply ${originMessageId}, для ${fullName})`,
      );
    } catch (error) {
      console.error(
        `[tasks/reminder] ошибка TG origin chat ${originChatId}:`,
        error.message,
      );
    }
  } else {
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

      try {
        await sendTaskTelegramMessage(telegramBot, chatId, message.text, keyboard, {
          ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
        });
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
  }

  const newDescription = appendReminderToDescription(
    claimed.description,
    sentAt,
  );
  await updateTaskDescription(claimed.id, newDescription);

  return { sent: true, sentCount };
}

module.exports = { processTaskReminder };
