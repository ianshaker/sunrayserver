const { sendInstallationQueueDocument } = require("./send");

function normalizePages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p.path === "string" && p.path.trim())
    .map((p, i) => ({
      role: typeof p.role === "string" ? p.role : "main",
      path: p.path.trim(),
      order: typeof p.order === "number" ? p.order : i,
    }))
    .sort((a, b) => a.order - b.order);
}

function registerInstallationQueueRoute(fastify, telegramBot) {
  fastify.post("/events/installation-queue", async (request, reply) => {
    try {
      const body = request.body || {};
      const {
        dogovorNumber,
        appealNumber,
        city,
        phone,
        installationSum,
        factorySummary,
        queueStatus,
        documents,
        comments,
        contractScanPages,
      } = body;

      const pages = normalizePages(contractScanPages);

      if (!dogovorNumber) {
        return reply.status(400).send({
          success: false,
          error: "Отсутствует dogovorNumber",
        });
      }
      if (pages.length === 0) {
        return reply.status(400).send({
          success: false,
          error:
            "Отсутствует contractScanPages — автоотправка без фото недоступна",
        });
      }

      const { messageId } = await sendInstallationQueueDocument(telegramBot, {
        dogovorNumber,
        appealNumber,
        city,
        phone,
        installationSum,
        factorySummary,
        queueStatus,
        documents,
        comments,
        contractScanPages: pages,
      });

      return reply.send({
        success: true,
        sent: true,
        messageId,
      });
    } catch (error) {
      console.error("[installation-queue] ❌", error);
      const status = error?.statusCode || 500;
      return reply.status(status).send({
        success: false,
        error:
          status === 404
            ? error.message
            : "Ошибка отправки в монтажный чат",
        details: error?.message || String(error),
      });
    }
  });
}

module.exports = {
  registerInstallationQueueRoute,
};
