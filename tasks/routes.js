const { ROUTE_PATH } = require("./config");
const {
  handleTaskCreated,
  handleTaskUpdated,
  handleTaskCompleted,
} = require("./handlers");

const REQUIRED_FIELDS = ["type", "task", "assignees", "assigned_by"];

function registerTaskRoute(fastify, telegramBot) {
  fastify.post(ROUTE_PATH, async (request, reply) => {
    try {
      console.log("📥 [tasks] Уведомление:", request.body?.type);

      const { type, task, assignees, assigned_by } = request.body || {};

      const missing = REQUIRED_FIELDS.filter((field) => !request.body?.[field]);
      if (missing.length) {
        return reply.status(400).send({
          error: "Missing required fields",
          required: REQUIRED_FIELDS,
          missing,
        });
      }

      switch (type) {
        case "task_created":
          await handleTaskCreated(task, assignees, assigned_by, telegramBot);
          break;
        case "task_updated":
          await handleTaskUpdated(task, assignees, assigned_by, telegramBot);
          break;
        case "task_completed":
          await handleTaskCompleted(task, assignees, assigned_by, telegramBot);
          break;
        default:
          console.log("⚠️ [tasks] Неизвестный type:", type);
      }

      return reply.status(200).send({
        status: "success",
        message: "Task notification processed",
        processed_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ [tasks] Ошибка обработки:", error);
      return reply.status(500).send({
        error: "Internal server error",
        message: error.message,
      });
    }
  });
}

module.exports = { registerTaskRoute };
