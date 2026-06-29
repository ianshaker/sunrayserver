// Самовосстановление вебхука.
//
// Вебхук живёт на стороне Telegram и переживает наши рестарты/redeploy.
// Но на всякий случай: при старте и раз в 15 минут проверяем getWebhookInfo
// и, если намерение active=true, а реальный URL не наш или есть ошибка —
// переустанавливаем. Так связь «бот ↔ сервер» чинится сама.

const schedule = require("node-schedule");
const api = require("./api");
const { activateWebhook } = require("./manager");
const { readState } = require("./store");
const { WEBHOOK_URL } = require("./config");

async function ensureWebhookHealthy(reason) {
  const state = await readState();

  // Чиним только если пользователь включил вебхук через страницу.
  if (!state || !state.active) {
    return { skipped: true };
  }

  try {
    const info = await api.getWebhookInfo();
    const ok =
      info && info.url === WEBHOOK_URL && !info.last_error_message;

    if (ok) return { ok: true };

    console.log(
      `[tgwebhook] self-heal (${reason}): переустанавливаю вебхук ` +
        `(текущий url=${info && info.url}, ошибка=${info && info.last_error_message})`,
    );
    await activateWebhook({});
    return { repaired: true };
  } catch (e) {
    console.error(`[tgwebhook] self-heal (${reason}) ошибка:`, e.message);
    return { error: e.message };
  }
}

function startWebhookSelfHeal() {
  // На старте — с задержкой, чтобы HTTP успел подняться.
  setTimeout(() => {
    ensureWebhookHealthy("boot").catch((e) =>
      console.error("[tgwebhook] self-heal boot:", e.message),
    );
  }, 5000);

  // Периодически — каждые 15 минут.
  schedule.scheduleJob("0 */15 * * * *", () => {
    ensureWebhookHealthy("cron").catch((e) =>
      console.error("[tgwebhook] self-heal cron:", e.message),
    );
  });

  console.log("[tgwebhook] self-heal запущен (старт + каждые 15 мин).");
}

module.exports = { startWebhookSelfHeal, ensureWebhookHealthy };
