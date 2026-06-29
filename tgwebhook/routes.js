// Fastify-роуты вебхука:
//   POST /telegram/webhook        — приём апдейтов от Telegram (валидация секретом)
//   GET  /telegram/setup          — страница управления
//   POST /telegram/setup/activate — поставить/переустановить вебхук
//   POST /telegram/setup/delete   — удалить вебхук
//   GET  /telegram/setup/status   — JSON-статус (для проверок/автоматизаций)

const {
  WEBHOOK_PATH,
  SETUP_PATH,
  ACTIVATE_PATH,
  DELETE_PATH,
  STATUS_PATH,
} = require("./config");
const {
  validateTelegramSecret,
  guardSetupAccess,
  extractSetupKey,
  appendSetupKey,
} = require("./guard");
const { dispatchUpdate } = require("./dispatcher");
const {
  activateWebhook,
  removeWebhook,
  refreshInfo,
  buildStatus,
} = require("./manager");
const { renderWebhookPage } = require("./pageHtml");

function redirectWithFlag(reply, key, flag) {
  const url = appendSetupKey(SETUP_PATH, key);
  const sep = url.includes("?") ? "&" : "?";
  return reply.redirect(`${url}${sep}${flag}`);
}

function registerTelegramWebhook(fastify) {
  // --- Входящие апдейты от Telegram --- //
  fastify.post(WEBHOOK_PATH, async (request, reply) => {
    if (!validateTelegramSecret(request)) {
      request.log.warn("[tgwebhook] неверный secret_token у входящего апдейта");
      return reply.code(401).send({ ok: false });
    }

    const update = request.body;
    const updateId = update?.update_id;

    if (update?.message) {
      const m = update.message;
      const text = m.text || m.caption || `[${m.sticker ? "sticker" : m.photo ? "photo" : "no text"}]`;
      console.log(
        `[tgwebhook] message update=${updateId} chat=${m.chat?.id} ` +
          `from=@${m.from?.username || "—"} id=${m.from?.id} text="${String(text).slice(0, 100)}"`,
      );
    } else if (update?.callback_query) {
      const cb = update.callback_query;
      console.log(
        `[tgwebhook] callback update=${updateId} chat=${cb.message?.chat?.id} ` +
          `from=@${cb.from?.username || "—"} data="${cb.data || ""}"`,
      );
    } else if (update) {
      console.log(
        `[tgwebhook] update=${updateId} type=${Object.keys(update).filter((k) => k !== "update_id").join(",") || "?"}`,
      );
    }
    // Подтверждаем мгновенно, обрабатываем асинхронно (Telegram ждёт быстрый 200).
    setImmediate(() => {
      dispatchUpdate(update).catch((e) =>
        console.error("[tgwebhook] dispatch:", e.message),
      );
    });

    return reply.send({ ok: true });
  });

  // --- Страница управления --- //
  fastify.get(SETUP_PATH, async (request, reply) => {
    if (guardSetupAccess(request, reply)) return;

    const key = extractSetupKey(request);
    let message = null;
    let messageType = "info";

    if (request.query.success === "activated") {
      message = "Вебхук активирован и проверен.";
      messageType = "success";
    } else if (request.query.success === "deleted") {
      message = "Вебхук удалён. Бот больше не получает входящие.";
      messageType = "info";
    } else if (request.query.error) {
      message = String(request.query.error);
      messageType = "error";
    }

    let status;
    try {
      status = buildStatus(await refreshInfo());
    } catch (e) {
      status = buildStatus(null);
      message = message || `Не удалось получить статус: ${e.message}`;
      messageType = "error";
    }

    return reply
      .type("text/html")
      .send(renderWebhookPage({ key, message, messageType, status }));
  });

  // --- Активация / переустановка --- //
  fastify.post(ACTIVATE_PATH, async (request, reply) => {
    if (guardSetupAccess(request, reply)) return;

    const key = extractSetupKey(request);
    const dropPending = request.body?.drop_pending === "1";

    try {
      await activateWebhook({ dropPending });
      return redirectWithFlag(reply, key, "success=activated");
    } catch (e) {
      console.error("[tgwebhook] активация:", e.message);
      return reply.type("text/html").send(
        renderWebhookPage({
          key,
          message: `Ошибка активации: ${e.message}`,
          messageType: "error",
          status: buildStatus(null),
        }),
      );
    }
  });

  // --- Удаление --- //
  fastify.post(DELETE_PATH, async (request, reply) => {
    if (guardSetupAccess(request, reply)) return;

    const key = extractSetupKey(request);

    try {
      await removeWebhook({ dropPending: true });
      return redirectWithFlag(reply, key, "success=deleted");
    } catch (e) {
      console.error("[tgwebhook] удаление:", e.message);
      return reply.type("text/html").send(
        renderWebhookPage({
          key,
          message: `Ошибка удаления: ${e.message}`,
          messageType: "error",
          status: buildStatus(null),
        }),
      );
    }
  });

  // --- JSON-статус для проверок --- //
  fastify.get(STATUS_PATH, async (request, reply) => {
    if (guardSetupAccess(request, reply)) return;
    try {
      return reply.send(buildStatus(await refreshInfo()));
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}

module.exports = { registerTelegramWebhook };
