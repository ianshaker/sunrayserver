// POST /api/calls/ask — семантический вопрос по AI-сводкам звонков клиента.
const { MAX_CALLS, MAX_CALLS_HARD } = require("./config");
const { askAboutCalls } = require("./service");

function registerAskRoute(fastify) {
  fastify.post("/api/calls/ask", async (request, reply) => {
    const phone = request.body?.phone;
    const question = request.body?.question;
    const limit = request.body?.limit;

    try {
      const result = await askAboutCalls({
        phone,
        question,
        limit: limit ? Math.min(parseInt(limit, 10) || MAX_CALLS, MAX_CALLS_HARD) : undefined,
      });

      if (result.status === "error") {
        const code =
          result.error === "phone_required" || result.error === "question_required" ? 400 : 503;
        return reply.code(code).send(result);
      }
      return reply.send(result);
    } catch (e) {
      request.log.error({ err: e.message }, "call ask failed");
      return reply.code(500).send({ status: "error", error: "internal", message: e.message });
    }
  });
}

module.exports = { registerAskRoute };
