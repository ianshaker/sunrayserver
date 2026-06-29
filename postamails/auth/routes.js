const {
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
} = require("../config");
const { guardSetupAccess, extractSetupKey, appendSetupKey } = require("./guard");
const { renderSetupPage } = require("./pageHtml");
const { extractGoogleAuthCode } = require("./extractAuthCode");
const { generateAuthUrl, exchangeCodeForTokens } = require("../gmail/oauth");
const { writeToken, isTokenPersistedInSupabase } = require("../gmail/tokenStore");
const { reloadGmailClientAfterTokenSave } = require("../gmail/client");
const {
  notifyGmailActivated,
  notifyGmailTokenNotPersisted,
} = require("../telegramNotify");

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
    const rawCode = (request.body?.code || "").trim();
    const code = extractGoogleAuthCode(rawCode);

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
      console.log("[postamails] /exchange-code: меняем код на токен...");
      const { tokens } = await exchangeCodeForTokens(code);
      console.log("[postamails] токен от Google получен, сохраняем в Supabase...");

      await writeToken(tokens);
      await reloadGmailClientAfterTokenSave(tokens);

      // Честная проверка: токен реально лёг в БД, а не только in-memory/диск этого инстанса.
      const persisted = await isTokenPersistedInSupabase();

      if (!persisted) {
        console.error(
          "[postamails] ❌ активация НЕ завершена: токен не сохранён в Supabase.",
        );
        notifyGmailTokenNotPersisted().catch((e) =>
          console.error("[postamails] TG (не сохранён):", e.message),
        );
        return reply.type("text/html").send(
          renderSetupPage({
            key,
            message:
              "Код принят, но токен НЕ сохранён в базу. Проверьте миграции gmail_oauth_tokens и попробуйте снова. Почта пока работать не будет.",
            messageType: "error",
          }),
        );
      }

      console.log("[postamails] ✅ активация завершена, токен в Supabase.");
      notifyGmailActivated().catch((e) => {
        console.error("[postamails] TG после активации Gmail:", e.message);
      });

      const successUrl = appendSetupKey(SETUP_PATH, key);
      const sep = successUrl.includes("?") ? "&" : "?";
      return reply.redirect(`${successUrl}${sep}success=1`);
    } catch (error) {
      console.error("[postamails] ❌ ошибка обмена кода:", error.message);
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
