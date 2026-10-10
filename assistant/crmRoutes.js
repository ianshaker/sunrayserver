// ============================================================================
// HTTP Нейробота в CRM (PLANS/CRM/18-neyrobot-na-glavnoy, буква Б):
//   POST /api/neurobot/message — Bearer authenticated (менеджер), как /api/mango-calls/request-ai.
//   Тело { text }. Ответ { status: "ok", messages, deleted, toasts } — что бот написал или изменил в чате CRM.
// Сообщение в базу не пишет: пишущие умения показывают превью, запись — по кнопке «Сохранить» (буква В).
//   POST /api/neurobot/button — тот же пропуск. Тело { messageId, data } — кнопка под сообщением бота; пишет,
//   если это «Сохранить». Ответ тот же: изменённые сообщения, удалённые, всплывающие подсказки.
// ============================================================================

const { MAX_INPUT_CHARS } = require("./config");

const MESSAGE_PATH = "/api/neurobot/message";
const BUTTON_PATH = "/api/neurobot/button";

// Ленивые зависимости: тест подставляет свои, сервер берёт настоящие
const nastoyashchie = {
  proveritPolzovatelya: (...a) => require("../lib/telegramBotChatsAdmin").assertAuthenticatedFromRequest(...a),
  otvetit: (...a) => require("./crm").soobshchenieIzCrm(...a),
  nazhat: (...a) => require("./crm").knopkaIzCrm(...a),
};

function registerNeurobotRoutes(fastify, zavisimosti = {}) {
  const { proveritPolzovatelya, otvetit, nazhat } = { ...nastoyashchie, ...zavisimosti };

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

  fastify.post(BUTTON_PATH, async (request, reply) => {
    const user = await proveritPolzovatelya(request, reply);
    if (!user) return;

    const messageId = Number(request.body?.messageId);
    const data = typeof request.body?.data === "string" ? request.body.data : "";
    if (!Number.isInteger(messageId) || messageId <= 0 || !data) {
      return reply.code(400).send({ status: "error", error: "invalid_body", message: "Ожидается { messageId, data }" });
    }

    try {
      const otvet = await nazhat({ profileId: user.id, messageId, data });
      if (otvet.oshibka === "net_soobshcheniya") {
        return reply.code(404).send({
          status: "error",
          error: "message_gone",
          message: "Сообщение устарело — напишите запрос заново",
        });
      }
      if (otvet.oshibka === "net_knopki") {
        return reply.code(400).send({ status: "error", error: "no_such_button", message: "Под этим сообщением такой кнопки нет" });
      }
      console.log(
        `[neurobot] кнопка CRM ${user.email || user.id}: изменено ${otvet.messages.length}, в чужие чаты ${otvet.vChuzhieChaty}`,
      );
      const { vChuzhieChaty, ...dlyaCrm } = otvet;
      return reply.send({ status: "ok", ...dlyaCrm });
    } catch (e) {
      console.error("[neurobot] кнопка CRM: сбой:", e.stack || e.message);
      return reply.code(500).send({ status: "error", error: "internal", message: "Не удалось выполнить. Попробуйте позже." });
    }
  });
}

module.exports = { registerNeurobotRoutes, MESSAGE_PATH, BUTTON_PATH };
