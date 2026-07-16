// ============================================================================
// HTTP: POST /api/mango-calls/delete  — Bearer superadmin
// Body: { ids: string[] }
// ============================================================================

const { assertSuperAdminFromRequest } = require("../lib/telegramBotChatsAdmin");
const { DELETE_PATH } = require("./config");
const { deleteRowsByIds } = require("./cleanup");

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
}

module.exports = { registerMangoCallsRoutes };
