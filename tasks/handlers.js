const { getChatIdForUser } = require("./directory");
const {
  buildTaskCreatedMessage,
  buildTaskUpdatedMessage,
  buildTaskCompletedMessage,
} = require("./messages");
const { sendTaskTelegramMessage } = require("./telegram");
const { buildTaskActionKeyboard } = require("./keyboards");

async function notifyAssignees({
  assignees,
  assignedBy,
  skipCreator = false,
  buildMessage,
  buildKeyboard,
  telegramBot,
  logLabel,
}) {
  for (const assignee of assignees) {
    if (skipCreator && assignee.id === assignedBy.id) {
      console.log(
        `⏭️ [tasks] Пропуск уведомления создателю ${assignee.full_name}`,
      );
      continue;
    }

    const chatId = await getChatIdForUser(assignee.id);
    if (!chatId) {
      console.log(
        `⚠️ [tasks] Нет chat_id для ${assignee.full_name} (${assignee.id})`,
      );
      continue;
    }

    const message = buildMessage();
    const keyboard = buildKeyboard ? buildKeyboard() : undefined;

    try {
      await sendTaskTelegramMessage(telegramBot, chatId, message, keyboard);
      console.log(
        `✅ [tasks] ${logLabel} → ${assignee.full_name} (chat ${chatId})`,
      );
    } catch (error) {
      console.error(
        `❌ [tasks] Ошибка отправки (${logLabel}) для ${assignee.full_name}:`,
        error,
      );
    }
  }
}

async function handleTaskCreated(task, assignees, assignedBy, telegramBot) {
  console.log("🆕 [tasks] Создание:", task.title);

  await notifyAssignees({
    assignees,
    assignedBy,
    skipCreator: true,
    telegramBot,
    logLabel: "новая задача",
    buildMessage: () => buildTaskCreatedMessage(task, assignedBy),
    buildKeyboard: () => buildTaskActionKeyboard(task.task_number),
  });
}

async function handleTaskUpdated(task, assignees, assignedBy, telegramBot) {
  console.log("🔄 [tasks] Обновление:", task.title);

  await notifyAssignees({
    assignees,
    assignedBy,
    skipCreator: false,
    telegramBot,
    logLabel: "обновление задачи",
    buildMessage: () => buildTaskUpdatedMessage(task, assignedBy),
  });
}

async function handleTaskCompleted(task, assignees, assignedBy, telegramBot) {
  console.log("✅ [tasks] Завершение:", task.title);

  const chatId = await getChatIdForUser(assignedBy.id);
  if (!chatId) {
    console.log(
      `⚠️ [tasks] Нет chat_id создателя ${assignedBy.full_name} (${assignedBy.id})`,
    );
    return;
  }

  const message = buildTaskCompletedMessage(task, assignees, assignedBy);

  try {
    await sendTaskTelegramMessage(telegramBot, chatId, message);
    console.log(
      `✅ [tasks] завершение → автор ${assignedBy.full_name} (chat ${chatId})`,
    );
  } catch (error) {
    console.error(
      `❌ [tasks] Ошибка уведомления о завершении для ${assignedBy.full_name}:`,
      error,
    );
  }
}

module.exports = {
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
};
