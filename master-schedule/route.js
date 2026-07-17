// ============================================================================
// POST /events/master-schedule — JPEG графика мастера в его TG-чат,
// затем отсчеки 1, 2, 3… reply на карточки (body.checkmarks).
//
// Body: { masterName, dateLabel, imageBase64, checkmarks?: [{ tg_message_link }] }
// Ответ: { status: "ok", sent: true, messageId, checkmarks } | { status: "error", ... }
// ============================================================================

const { MASTER_CHAT_IDS } = require("./config");
const { sendMasterSchedulePhoto } = require("./send");
const { sendScheduleCheckmarks } = require("./checkmarks");

function fail(reply, code, error) {
  return reply.code(code).send({ status: "error", sent: false, error });
}

function ok(reply, payload) {
  return reply.send({ status: "ok", sent: true, ...payload });
}

function decodeJpegBase64(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new Error("imageBase64 обязателен");
  }
  let raw = imageBase64.trim();
  const dataUrl = raw.match(/^data:image\/jpeg;base64,(.+)$/i);
  if (dataUrl) raw = dataUrl[1];
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 100) {
    throw new Error("imageBase64 слишком короткий");
  }
  return buf;
}

function registerMasterScheduleRoute(fastify) {
  fastify.post("/events/master-schedule", async (request, reply) => {
    try {
      const { masterName, dateLabel, imageBase64, checkmarks } =
        request.body || {};

      const normalizedName = masterName
        ? String(masterName).trim().toUpperCase()
        : null;
      if (!normalizedName) {
        return fail(reply, 400, "Не указан masterName");
      }

      const chatId = MASTER_CHAT_IDS[normalizedName];
      if (!chatId) {
        return fail(
          reply,
          400,
          `Чат для мастера "${masterName}" не найден`,
        );
      }

      let jpegBuffer;
      try {
        jpegBuffer = decodeJpegBase64(imageBase64);
      } catch (e) {
        return fail(reply, 400, e.message || "Некорректный imageBase64");
      }

      const displayName =
        String(masterName).trim() || normalizedName;
      const datePart = dateLabel ? String(dateLabel).trim() : "";
      const caption = datePart
        ? `График · ${displayName} · ${datePart}`
        : `График · ${displayName}`;

      console.log(
        `[master-schedule] → ${normalizedName} chat=${chatId} jpeg=${jpegBuffer.length}b checkmarks=${Array.isArray(checkmarks) ? checkmarks.length : 0}`,
      );

      const { messageId } = await sendMasterSchedulePhoto({
        chatId,
        caption,
        jpegBuffer,
      });

      console.log(
        `[master-schedule] ✅ ${normalizedName} message_id=${messageId ?? "—"}`,
      );

      const checkmarkStats = await sendScheduleCheckmarks({
        chatId,
        checkmarks: Array.isArray(checkmarks) ? checkmarks : [],
      });

      console.log(
        `[master-schedule] checkmarks sent=${checkmarkStats.sent} skipped=${checkmarkStats.skipped} failed=${checkmarkStats.failed}`,
      );

      return ok(reply, {
        chatId,
        messageId,
        type: "master_schedule",
        checkmarks: checkmarkStats,
      });
    } catch (err) {
      console.error("[master-schedule] error:", err);
      return fail(
        reply,
        500,
        err?.message || "Ошибка отправки графика в Telegram",
      );
    }
  });
}

module.exports = {
  registerMasterScheduleRoute,
};
