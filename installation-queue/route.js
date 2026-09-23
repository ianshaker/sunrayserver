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
        installerNote,
        contractScanPages,
      } = body;

      // Заметка монтажникам. С 23.09.2026 CRM шлёт её отдельным полем installerNote,
      // а comments договора стал историей сделки — переписка с клиентом монтажникам
      // не нужна. Старая CRM installerNote не знает и шлёт comments: пока её не
      // обновили у всех, печатаем его. Пустая строка в installerNote — «заметки нет»,
      // и тогда comments не подставляется.
      const note = installerNote !== undefined ? installerNote : comments;

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
        comments: note,
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
