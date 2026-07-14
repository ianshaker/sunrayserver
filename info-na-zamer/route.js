// ============================================================================
// POST /events/zamer — уведомления мастерам / в погрузку из CRM.
// Эндпоинт исторически называется zamer; тип берём из body.eventType.
//
// Контракт ответа (CRM ждёт sent === true перед закрытием заявки):
//   200 { status: "ok", sent: true, messageId?, ... }
//   4xx/5xx { status: "error", sent: false, error }
// ============================================================================

const { LOADING_CHAT_ID, MASTER_CHAT_IDS } = require("./config");
const { formatDate, formatTimeRange } = require("./format");
const { resolveEventLabels } = require("./labels");
const { buildClientCard, buildCancelMessage } = require("./messages");

function fail(reply, code, error) {
  return reply.code(code).send({ status: "error", sent: false, error });
}

function ok(reply, payload) {
  return reply.send({ status: "ok", sent: true, ...payload });
}

function registerZamerRoute(fastify, telegramBot) {
  fastify.post("/events/zamer", async (request, reply) => {
    try {
      const {
        appealNumber,
        clientName,
        phone,
        city,
        address,
        detailedAddress,
        dialog,
        masterName,
        date,
        startTime,
        endTime,
        eventType,
        updateType,
        oldMaster,
        reason,
      } = request.body || {};

      const normalizedName = masterName ? String(masterName).trim().toUpperCase() : null;
      const prevNormalizedName = oldMaster ? String(oldMaster).trim().toUpperCase() : null;
      const formattedDate = formatDate(date);
      const formattedTime = formatTimeRange(startTime, endTime);
      const labels = resolveEventLabels(eventType);

      const cardFields = {
        appealNumber,
        clientName,
        phone,
        city,
        address,
        detailedAddress,
        dialog,
        masterName,
        formattedDate,
        formattedTime,
      };

      // 1. Обновление (смена даты/времени)
      if (updateType === "updated") {
        if (!normalizedName) {
          return fail(reply, 400, "Не указан мастер для обновления");
        }
        const chatId = MASTER_CHAT_IDS[normalizedName];
        if (!chatId) {
          return fail(reply, 400, `Чат для мастера "${masterName}" не найден`);
        }
        const msg = buildClientCard({
          ...cardFields,
          header: `ОБНОВЛЕНИЕ ПО ${labels.update} ${appealNumber || ""}`.trim(),
        });
        const sentMsg = await telegramBot.sendMessage(chatId, msg);
        return ok(reply, {
          chatId,
          messageId: sentMsg?.message_id ?? null,
          type: "update",
          eventType: labels.kind,
        });
      }

      // 2. Переназначение мастера (отмена старому + заявка новому)
      if (updateType === "reassigned") {
        if (!normalizedName) {
          return fail(reply, 400, "Не указан новый мастер");
        }
        const newChatId = MASTER_CHAT_IDS[normalizedName];
        if (!newChatId) {
          return fail(reply, 400, `Чат для мастера "${masterName}" не найден`);
        }

        let cancelMessageId = null;
        if (prevNormalizedName && MASTER_CHAT_IDS[prevNormalizedName]) {
          const cancelSent = await telegramBot.sendMessage(
            MASTER_CHAT_IDS[prevNormalizedName],
            buildCancelMessage({
              labels,
              appealNumber,
              city,
              address,
              formattedDate,
              formattedTime,
            }),
          );
          cancelMessageId = cancelSent?.message_id ?? null;
        }

        const msg = buildClientCard({
          ...cardFields,
          header: `ЗАЯВКА НА ${labels.request} ${appealNumber || ""}`.trim(),
        });
        const sentMsg = await telegramBot.sendMessage(newChatId, msg);

        return ok(reply, {
          chatId: newChatId,
          messageId: sentMsg?.message_id ?? null,
          cancelMessageId,
          type: "reassigned",
          eventType: labels.kind,
        });
      }

      // 3. Отмена / отказ (только отбивка мастеру, без новой заявки)
      if (updateType === "cancelled") {
        if (!normalizedName) {
          return fail(reply, 400, "Не указан мастер для отмены");
        }
        const chatId = MASTER_CHAT_IDS[normalizedName];
        if (!chatId) {
          return fail(reply, 400, `Чат для мастера "${masterName}" не найден`);
        }

        const cancelMsg = buildCancelMessage({
          labels,
          appealNumber,
          city,
          address,
          formattedDate,
          formattedTime,
          footer: reason ? `Причина: ${reason}` : "Отменён в CRM.",
        });

        const sentMsg = await telegramBot.sendMessage(chatId, cancelMsg);
        return ok(reply, {
          chatId,
          messageId: sentMsg?.message_id ?? null,
          type: "cancelled",
          eventType: labels.kind,
        });
      }

      // 4. Новая заявка или погрузка
      const isLoading =
        labels.kind === "loading" ||
        !masterName ||
        masterName.trim() === "" ||
        masterName.toLowerCase().includes("погрузка");

      let chatId;
      let msg;
      if (isLoading) {
        chatId = LOADING_CHAT_ID;
        msg = buildClientCard({
          ...cardFields,
          masterName: null,
          header: `ЗАЯВКА НА ПОГРУЗКУ ${appealNumber || ""}`.trim(),
        });
      } else {
        chatId = MASTER_CHAT_IDS[normalizedName];
        if (!chatId) {
          return fail(reply, 400, `Чат для мастера "${masterName}" не найден`);
        }
        msg = buildClientCard({
          ...cardFields,
          header: `ЗАЯВКА НА ${labels.request} ${appealNumber || ""}`.trim(),
        });
      }

      const sentMsg = await telegramBot.sendMessage(chatId, msg);

      return ok(reply, {
        chatId,
        messageId: sentMsg?.message_id ?? null,
        type: isLoading ? "loading" : labels.kind,
        master: masterName || null,
        eventType: labels.kind,
      });
    } catch (e) {
      console.error("[info-na-zamer] ошибка /events/zamer:", e.message);
      return fail(reply, 502, e.message || "Telegram send failed");
    }
  });
}

module.exports = { registerZamerRoute };
