// ============================================================================
// Низкоуровневый клиент Telegram Bot API (через встроенный https, без либ).
// Используется для администрирования вебхука: setWebhook/getWebhookInfo/delete.
// Отправку сообщений делает node-telegram-bot-api (см. bot.js).
// ============================================================================

const https = require("https");
const { TELEGRAM_TOKEN } = require("./config");

function callTelegram(method, params) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params || {});
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) {
            return reject(
              new Error(json.description || `Telegram ${method}: ok=false`),
            );
          }
          resolve(json.result);
        } catch (e) {
          reject(
            new Error(
              `Telegram ${method}: некорректный ответ — ${String(data).slice(0, 200)}`,
            ),
          );
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Telegram ${method}: таймаут`));
    });
    req.write(payload);
    req.end();
  });
}

async function setWebhook(opts) {
  const {
    url,
    secret,
    allowedUpdates,
    dropPending = false,
    maxConnections = 40,
  } = opts || {};

  const params = {
    url,
    drop_pending_updates: dropPending,
    max_connections: maxConnections,
  };
  if (secret) params.secret_token = secret;
  if (allowedUpdates) params.allowed_updates = allowedUpdates;

  return callTelegram("setWebhook", params);
}

async function getWebhookInfo() {
  return callTelegram("getWebhookInfo", {});
}

async function deleteWebhook(opts) {
  const { dropPending = false } = opts || {};
  return callTelegram("deleteWebhook", { drop_pending_updates: dropPending });
}

module.exports = {
  callTelegram,
  setWebhook,
  getWebhookInfo,
  deleteWebhook,
};
