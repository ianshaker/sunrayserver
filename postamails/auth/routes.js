const {
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
} = require("../config");
const { guardSetupAccess, extractSetupKey, appendSetupKey } = require("./guard");
const { renderSetupPage } = require("./pageHtml");
const { generateAuthUrl, exchangeCodeForTokens } = require("../gmail/oauth");
const { writeToken } = require("../gmail/tokenStore");
const { reloadGmailClientAfterTokenSave } = require("../gmail/client");

function registerGmailAuthRoutes(fastify) {
  fastify.get(SETUP_PATH, async (request, reply) => {
    const blocked = guardSetupAccess(request, reply);
    if (blocked) return blocked;

    const key = extractSetupKey(request);
    let message = null;
    let messageType = "info";

    if (request.query.success === "1") {
      message = "Gmail API активирован. Проверка почты возобновится автоматически.";
      messageType = "success";
    } else if (request.query.error) {
      message = String(request.query.error);
      messageType = "error";
    }

    return reply
      .type("text/html")
      .send(renderSetupPage({ key, message, messageType }));
  });

  fastify.get(START_PATH, async (request, reply) => {
    const blocked = guardSetupAccess(request, reply);
    if (blocked) return blocked;

    try {
      const url = generateAuthUrl();
      return reply.redirect(url);
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  fastify.post(EXCHANGE_PATH, async (request, reply) => {
    const blocked = guardSetupAccess(request, reply);
    if (blocked) return blocked;

    const key = extractSetupKey(request);
    const code = (request.body?.code || "").trim();

    if (!code) {
      return reply
        .type("text/html")
        .send(
          renderSetupPage({
            key,
            message: "Введите код от Google.",
            messageType: "error",
          }),
        );
    }

    try {
      const { tokens } = await exchangeCodeForTokens(code);
      writeToken(tokens);
      await reloadGmailClientAfterTokenSave(tokens);

      const successUrl = appendSetupKey(SETUP_PATH, key);
      const sep = successUrl.includes("?") ? "&" : "?";
      return reply.redirect(`${successUrl}${sep}success=1`);
    } catch (error) {
      return reply
        .type("text/html")
        .send(
          renderSetupPage({
            key,
            message: `Ошибка авторизации: ${error.message}`,
            messageType: "error",
          }),
        );
    }
  });
}

module.exports = { registerGmailAuthRoutes };
