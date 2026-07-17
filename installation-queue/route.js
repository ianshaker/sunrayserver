const { sendInstallationQueueDocument } = require("./send");

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
        contractScanPath,
      } = body;

      const scanPath =
        typeof contractScanPath === "string" ? contractScanPath.trim() : "";

      if (!dogovorNumber) {
        return reply.status(400).send({
          success: false,
          error: "Отсутствует dogovorNumber",
        });
      }
      if (!scanPath) {
        return reply.status(400).send({
          success: false,
          error: "Отсутствует contractScanPath — автоотправка без PDF недоступна",
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
        contractScanPath: scanPath,
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
