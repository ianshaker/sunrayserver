// ============================================================================
// HTTP:
//   POST /api/mango-calls/delete      — Bearer superadmin
//   POST /api/mango-calls/request-ai  — Bearer authenticated (менеджер)
// ============================================================================

const {
  assertSuperAdminFromRequest,
  assertAuthenticatedFromRequest,
} = require("../lib/telegramBotChatsAdmin");
const { DELETE_PATH, REQUEST_AI_PATH } = require("./config");
const { deleteRowsByIds } = require("./cleanup");
const { requestAiForCall } = require("./requestAi");

function registerMangoCallsRoutes(fastify) {
  fastify.post(DELETE_PATH, async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const ids = request.body?.ids;
    if (!Array.isArray(ids)) {
      return reply.code(400).send({
        status: "error",
        error: "invalid_body",
        message: "Ожидается { ids: string[] }",
      });
    }

    try {
      const result = await deleteRowsByIds(ids);
      console.log(
        `[mango-calls] delete by ${user.email || user.id}: deleted=${result.deleted}, skipped=${result.skipped.length}`,
      );
      return reply.send({ status: "ok", ...result });
    } catch (e) {
      if (e.code === "too_many_ids") {
        return reply.code(400).send({ status: "error", error: e.code, message: e.message });
      }
      console.error("[mango-calls] delete error:", e.message);
      return reply.code(500).send({
        status: "error",
        error: e.code || "delete_failed",
        message: e.message,
      });
    }
  });

  fastify.post(REQUEST_AI_PATH, async (request, reply) => {
    const user = await assertAuthenticatedFromRequest(request, reply);
    if (!user) return;

    const id = request.body?.id;
    if (typeof id !== "string" || !id.trim()) {
      return reply.code(400).send({
        status: "error",
        error: "invalid_body",
        message: "Ожидается { id: string }",
      });
    }

    try {
      const result = await requestAiForCall(id);
      if (result.status === "not_found") {
        return reply.code(404).send({ status: "error", error: "not_found", message: "Звонок не найден" });
      }
      if (result.status === "recording_not_ready") {
        return reply.code(400).send({
          status: "error",
          error: "recording_not_ready",
          message: "Нет готового файла записи",
          ...result,
        });
      }
      if (result.status === "too_short") {
        return reply.code(400).send({
          status: "error",
          error: "too_short",
          message: "Нужен разговор от 30 секунд",
          ...result,
        });
      }

      console.log(
        `[mango-calls] request-ai by ${user.email || user.id}: ${result.status} id=${result.id} entry=${result.entry_id}`,
      );
      return reply.send(result);
    } catch (e) {
      if (e.code === "invalid_body") {
        return reply.code(400).send({ status: "error", error: e.code, message: e.message });
      }
      console.error("[mango-calls] request-ai error:", e.message);
      return reply.code(500).send({
        status: "error",
        error: e.code || "request_ai_failed",
        message: e.message,
      });
    }
  });
}

module.exports = { registerMangoCallsRoutes };
