const {
  PUBLIC_BASE_URL,
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
} = require("../config");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSetupPage({ key, message, messageType = "info" }) {
  const startUrl = `${PUBLIC_BASE_URL}${START_PATH}?key=${encodeURIComponent(key)}`;
  const action = `${PUBLIC_BASE_URL}${EXCHANGE_PATH}`;

  const alert =
    message &&
    `<div class="alert ${messageType}">${escapeHtml(message)}</div>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SUNRAY — активация Gmail</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #f4f6f8; margin: 0; padding: 24px; color: #1a1a1a; }
    .card { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
    h1 { margin: 0 0 8px; font-size: 1.35rem; }
    p { line-height: 1.5; color: #444; }
    .steps { margin: 20px 0; padding-left: 20px; }
    .btn { display: inline-block; margin-top: 12px; padding: 12px 18px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .btn-google { background: #1a73e8; color: #fff; }
    .btn-submit { background: #2b8a3e; color: #fff; border: 0; cursor: pointer; width: 100%; margin-top: 12px; font-size: 1rem; padding: 12px; border-radius: 8px; }
    input[type=text] { width: 100%; padding: 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 1rem; margin-top: 8px; }
    .alert { padding: 12px; border-radius: 8px; margin-bottom: 16px; }
    .alert.success { background: #e6f4ea; color: #137333; }
    .alert.error { background: #fce8e6; color: #c5221f; }
    .alert.info { background: #e8f0fe; color: #174ea6; }
    label { font-weight: 600; font-size: .95rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Активация Gmail API</h1>
    <p>Нужно обновить доступ к почте «Заявки Sunray».</p>
    ${alert || ""}
    <ol class="steps">
      <li>Нажмите кнопку и войдите в Google.</li>
      <li>Скопируйте код, который покажет Google.</li>
      <li>Вставьте код ниже и нажмите «Активировать».</li>
    </ol>
    <a class="btn btn-google" href="${startUrl}">Перейти к авторизации Google</a>
    <form method="POST" action="${action}">
      <input type="hidden" name="key" value="${escapeHtml(key)}" />
      <label for="code">Код от Google</label>
      <input id="code" name="code" type="text" placeholder="4/0AfJoh..." required autocomplete="off" />
      <button class="btn-submit" type="submit">Активировать доступ</button>
    </form>
  </div>
</body>
</html>`;
}

module.exports = { renderSetupPage, escapeHtml };
