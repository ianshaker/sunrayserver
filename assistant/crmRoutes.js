// ============================================================================
// HTTP Нейробота в CRM (PLANS/CRM/18-neyrobot-na-glavnoy, буква Б):
//   POST /api/neurobot/message — Bearer authenticated (менеджер), как /api/mango-calls/request-ai.
//   Тело { text }. Ответ { status: "ok", messages, deleted, toasts } — что бот написал или изменил в чате CRM.
// Сообщение в базу не пишет: пишущие умения показывают превью, запись — по кнопке «Сохранить» (буква В).
// ============================================================================

const { MAX_INPUT_CHARS } = require("./config");

const MESSAGE_PATH = "/api/neurobot/message";

// Ленивые зависимости: тест подставляет свои, сервер берёт настоящие
const nastoyashchie = {
  proveritPolzovatelya: (...a) => require("../lib/telegramBotChatsAdmin").assertAuthenticatedFromRequest(...a),
  otvetit: (...a) => require("./crm").soobshchenieIzCrm(...a),
};

function registerNeurobotRoutes(fastify, zavisimosti = {}) {
  const { proveritPolzovatelya, otvetit } = { ...nastoyashchie, ...zavisimosti };

  fastify.post(MESSAGE_PATH, async (request, reply) => {
    const user = await proveritPolzovatelya(request, reply);
    if (!user) return;

    const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
    if (!text) {
      return reply.code(400).send({ status: "error", error: "text_required", message: "Напишите, что нужно сделать" });
    }
    if (text.length > MAX_INPUT_CHARS) {
      return reply.code(400).send({
        status: "error",
        error: "text_too_long",
        message: `Слишком длинно — до ${MAX_INPUT_CHARS} знаков`,
      });
    }

    try {
      const otvet = await otvetit({ profileId: user.id, text });
      console.log(
        `[neurobot] CRM ${user.email || user.id}: ответов ${otvet.messages.length}, в чужие чаты ${otvet.vChuzhieChaty}`,
      );
      const { vChuzhieChaty, ...dlyaCrm } = otvet;
      return reply.send({ status: "ok", ...dlyaCrm });
    } catch (e) {
      console.error("[neurobot] CRM: сбой:", e.stack || e.message);
      return reply
        .code(500)
        .send({ status: "error", error: "internal", message: "Не удалось обработать сообщение. Попробуйте позже." });
    }
  });
}

module.exports = { registerNeurobotRoutes, MESSAGE_PATH };
