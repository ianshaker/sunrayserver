// HTML страницы управления вебхуком (стиль Gmail-setup, тема Telegram).
// Показывает живой статус (getWebhookInfo) и кнопки активации/удаления.

const {
  PUBLIC_BASE_URL,
  ACTIVATE_PATH,
  DELETE_PATH,
  WEBHOOK_URL,
} = require("./config");
const { appendSetupKey } = require("./guard");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatUnix(sec) {
  if (!sec) return "—";
  try {
    return new Date(sec * 1000).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
    });
  } catch (e) {
    return String(sec);
  }
}

function row(label, value) {
  return `<div class="row"><span class="row-label">${escapeHtml(
    label,
  )}</span><span class="row-value">${value}</span></div>`;
}

function renderWebhookPage(opts) {
  const { key, message, messageType = "info", status } = opts || {};
  const info = (status && status.info) || {};
  const healthy = Boolean(status && status.healthy);

  const activateAction = `${PUBLIC_BASE_URL}${ACTIVATE_PATH}`;
  const deleteAction = `${PUBLIC_BASE_URL}${DELETE_PATH}`;
  const refreshUrl = appendSetupKey("/telegram/setup", key);
  const keyField = key
    ? `<input type="hidden" name="key" value="${escapeHtml(key)}" />`
    : "";

  const alert = message
    ? `<div class="alert ${messageType}">${escapeHtml(message)}</div>`
    : "";

  const badge = healthy
    ? `<span class="badge ok">● Активен</span>`
    : `<span class="badge off">● Не активен</span>`;

  const currentUrl = info.url
    ? escapeHtml(info.url)
    : '<span class="muted">не установлен</span>';

  const allowed =
    Array.isArray(info.allowed_updates) && info.allowed_updates.length
      ? escapeHtml(info.allowed_updates.join(", "))
      : '<span class="muted">по умолчанию</span>';

  const lastError = info.last_error_message
    ? `<span class="err">${escapeHtml(info.last_error_message)}</span>`
    : '<span class="muted">нет</span>';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#229ED9" />
  <title>SUNRAY — Telegram webhook</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #44403c;
      background:
        radial-gradient(ellipse 80% 60% at 20% 10%, rgba(34, 158, 217, 0.18), transparent 55%),
        radial-gradient(ellipse 70% 50% at 85% 90%, rgba(34, 158, 217, 0.12), transparent 50%),
        linear-gradient(160deg, #eff8fd 0%, #f5f5f4 45%, #e7e5e4 100%);
      padding: 24px 16px 48px;
    }
    .shell { max-width: 520px; margin: 0 auto; }
    .logo { text-align: center; margin-bottom: 20px; }
    .logo span {
      display: inline-flex; align-items: center; gap: 8px;
      font-weight: 700; font-size: 1.1rem; letter-spacing: 0.04em;
      color: #229ED9; text-transform: uppercase;
    }
    .logo-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #229ED9; box-shadow: 0 0 12px rgba(34, 158, 217, 0.6);
    }
    .card {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.75);
      border-radius: 20px; padding: 28px 24px 32px;
      box-shadow: 0 4px 24px rgba(34, 158, 217, 0.08), 0 1px 0 rgba(255, 255, 255, 0.9) inset;
    }
    h1 { margin: 0 0 6px; font-size: 1.35rem; font-weight: 700; color: #1c1917; }
    .subtitle { margin: 0 0 18px; line-height: 1.55; color: #78716c; font-size: 0.95rem; }
    .badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600;
      font-size: 0.82rem; padding: 5px 12px; border-radius: 999px; margin-bottom: 18px; }
    .badge.ok { background: rgba(34, 197, 94, 0.14); color: #15803d; border: 1px solid rgba(34, 197, 94, 0.25); }
    .badge.off { background: rgba(120, 113, 108, 0.12); color: #57534e; border: 1px solid rgba(120, 113, 108, 0.2); }
    .status { margin: 0 0 22px; border: 1px solid rgba(34, 158, 217, 0.18);
      border-radius: 14px; overflow: hidden; background: rgba(255, 255, 255, 0.6); }
    .row { display: flex; justify-content: space-between; gap: 12px;
      padding: 10px 14px; font-size: 0.86rem; border-bottom: 1px solid rgba(120, 113, 108, 0.1); }
    .row:last-child { border-bottom: 0; }
    .row-label { color: #78716c; flex-shrink: 0; }
    .row-value { color: #292524; text-align: right; word-break: break-all; font-weight: 500; }
    .muted { color: #a8a29e; font-weight: 400; }
    .err { color: #b91c1c; }
    .actions { display: flex; flex-direction: column; gap: 10px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px;
      padding: 13px 18px; border-radius: 12px; text-decoration: none; font-weight: 600;
      font-size: 0.95rem; border: 0; cursor: pointer; width: 100%;
      transition: transform 0.15s, box-shadow 0.15s; }
    .btn:active { transform: scale(0.98); }
    .btn-primary { color: #fff; background: linear-gradient(135deg, #229ED9 0%, #1b7fb0 100%);
      box-shadow: 0 4px 16px rgba(34, 158, 217, 0.35); }
    .btn-primary:hover { box-shadow: 0 6px 20px rgba(34, 158, 217, 0.45); }
    .btn-ghost { background: rgba(255, 255, 255, 0.7); color: #44403c; border: 1px solid rgba(120, 113, 108, 0.2); }
    .btn-danger { background: rgba(254, 242, 242, 0.9); color: #b91c1c; border: 1px solid rgba(239, 68, 68, 0.25); }
    .check { display: flex; align-items: center; gap: 8px; font-size: 0.85rem;
      color: #57534e; margin: 2px 0 6px; }
    .alert { padding: 12px 14px; border-radius: 12px; margin-bottom: 18px;
      font-size: 0.92rem; line-height: 1.45; border: 1px solid transparent; }
    .alert.success { background: rgba(236, 253, 243, 0.9); color: #137333; border-color: rgba(43, 138, 62, 0.25); }
    .alert.error { background: rgba(254, 242, 242, 0.95); color: #b91c1c; border-color: rgba(239, 68, 68, 0.2); }
    .alert.info { background: rgba(239, 246, 255, 0.9); color: #1d4ed8; border-color: rgba(59, 130, 246, 0.2); }
    .divider { display: flex; align-items: center; gap: 12px; margin: 20px 0 16px;
      color: #a8a29e; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
    .divider::before, .divider::after { content: ""; flex: 1; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(120, 113, 108, 0.25), transparent); }
  </style>
</head>
<body>
  <div class="shell">
    <div class="logo"><span><span class="logo-dot"></span> SunRay</span></div>
    <div class="card">
      <h1>Telegram webhook</h1>
      <p class="subtitle">Единый входящий канал бота: кнопки в напоминаниях, команды, будущие нейронки. Настраивается один раз.</p>
      ${alert}
      ${badge}
      <div class="status">
        ${row("Текущий URL", currentUrl)}
        ${row("Ожидаемый URL", escapeHtml(WEBHOOK_URL))}
        ${row("Ожидает доставки", escapeHtml(info.pending_update_count != null ? info.pending_update_count : "—"))}
        ${row("Типы апдейтов", allowed)}
        ${row("Последняя ошибка", lastError)}
        ${row("Время ошибки", escapeHtml(formatUnix(info.last_error_date)))}
        ${row("Кастомный сертификат", info.has_custom_certificate ? "да" : "нет")}
        ${row("IP Telegram", escapeHtml(info.ip_address || "—"))}
      </div>

      <div class="actions">
        <form method="POST" action="${activateAction}">
          ${keyField}
          <label class="check"><input type="checkbox" name="drop_pending" value="1" /> Сбросить накопившиеся апдейты</label>
          <button class="btn btn-primary" type="submit">${healthy ? "Переустановить вебхук" : "Активировать вебхук"}</button>
        </form>

        <a class="btn btn-ghost" href="${refreshUrl}">Обновить статус</a>

        <div class="divider">опасная зона</div>
        <form method="POST" action="${deleteAction}" onsubmit="return confirm('Удалить вебхук? Бот перестанет получать входящие сообщения.');">
          ${keyField}
          <button class="btn btn-danger" type="submit">Удалить вебхук</button>
        </form>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderWebhookPage, escapeHtml };
