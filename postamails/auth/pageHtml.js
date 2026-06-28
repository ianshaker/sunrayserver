const { PUBLIC_BASE_URL, EXCHANGE_PATH } = require("../config");
const { appendSetupKey } = require("./guard");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSetupPage({ key, message, messageType = "info" }) {
  const startUrl = appendSetupKey("/gmail/start", key);
  const action = `${PUBLIC_BASE_URL}${EXCHANGE_PATH}`;
  const keyField = key
    ? `<input type="hidden" name="key" value="${escapeHtml(key)}" />`
    : "";

  const alert =
    message &&
    `<div class="alert ${messageType}">${escapeHtml(message)}</div>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#2b8a3e" />
  <title>SUNRAY — активация Gmail</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #44403c;
      background:
        radial-gradient(ellipse 80% 60% at 20% 10%, rgba(43, 138, 62, 0.18), transparent 55%),
        radial-gradient(ellipse 70% 50% at 85% 90%, rgba(43, 138, 62, 0.12), transparent 50%),
        linear-gradient(160deg, #ecfdf3 0%, #f5f5f4 45%, #e7e5e4 100%);
      padding: 24px 16px 48px;
    }
    .shell {
      max-width: 480px;
      margin: 0 auto;
    }
    .logo {
      text-align: center;
      margin-bottom: 20px;
    }
    .logo span {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: 0.04em;
      color: #2b8a3e;
      text-transform: uppercase;
    }
    .logo-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #2b8a3e;
      box-shadow: 0 0 12px rgba(43, 138, 62, 0.6);
    }
    .card {
      background: rgba(255, 255, 255, 0.82);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.75);
      border-radius: 20px;
      padding: 28px 24px 32px;
      box-shadow:
        0 4px 24px rgba(43, 138, 62, 0.08),
        0 1px 0 rgba(255, 255, 255, 0.9) inset;
      ring: 1px solid rgba(255, 255, 255, 0.35);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 1.35rem;
      font-weight: 700;
      color: #1c1917;
    }
    .subtitle {
      margin: 0 0 20px;
      line-height: 1.55;
      color: #78716c;
      font-size: 0.95rem;
    }
    .steps {
      margin: 0 0 24px;
      padding-left: 20px;
      line-height: 1.65;
      color: #57534e;
      font-size: 0.92rem;
    }
    .steps li { margin-bottom: 6px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 13px 20px;
      border-radius: 12px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.95rem;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .btn:active { transform: scale(0.98); }
    .btn-google {
      width: 100%;
      background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
      color: #fff;
      box-shadow: 0 4px 16px rgba(26, 115, 232, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .btn-google:hover {
      box-shadow: 0 6px 20px rgba(26, 115, 232, 0.45);
    }
    .btn-google svg { flex-shrink: 0; }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 24px 0 20px;
      color: #a8a29e;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .divider::before, .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(120, 113, 108, 0.25), transparent);
    }
    label {
      display: block;
      font-weight: 600;
      font-size: 0.9rem;
      color: #44403c;
      margin-bottom: 6px;
    }
    .hint {
      font-size: 0.8rem;
      color: #a8a29e;
      margin-top: 6px;
      line-height: 1.45;
    }
    textarea {
      width: 100%;
      min-height: 88px;
      padding: 12px 14px;
      border: 1px solid rgba(255, 255, 255, 0.9);
      border-radius: 12px;
      font-size: 0.88rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      resize: vertical;
      background: rgba(255, 255, 255, 0.92);
      color: #292524;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) inset;
    }
    textarea:focus {
      outline: none;
      border-color: rgba(43, 138, 62, 0.45);
      box-shadow: 0 0 0 3px rgba(43, 138, 62, 0.15);
    }
    .btn-submit {
      width: 100%;
      margin-top: 14px;
      padding: 13px;
      border: 0;
      border-radius: 12px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, #2b8a3e 0%, #237032 100%);
      box-shadow: 0 4px 16px rgba(43, 138, 62, 0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .btn-submit:hover {
      box-shadow: 0 6px 20px rgba(43, 138, 62, 0.45);
    }
    .btn-submit:active { transform: scale(0.98); }
    .alert {
      padding: 12px 14px;
      border-radius: 12px;
      margin-bottom: 18px;
      font-size: 0.92rem;
      line-height: 1.45;
      border: 1px solid transparent;
    }
    .alert.success {
      background: rgba(236, 253, 243, 0.9);
      color: #137333;
      border-color: rgba(43, 138, 62, 0.25);
    }
    .alert.error {
      background: rgba(254, 242, 242, 0.95);
      color: #b91c1c;
      border-color: rgba(239, 68, 68, 0.2);
    }
    .alert.info {
      background: rgba(239, 246, 255, 0.9);
      color: #1d4ed8;
      border-color: rgba(59, 130, 246, 0.2);
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="logo"><span><span class="logo-dot"></span> SunRay</span></div>
    <div class="card">
      <h1>Активация Gmail</h1>
      <p class="subtitle">Обновите доступ к почте «Заявки Sunray» для автоматической обработки заявок.</p>
      ${alert || ""}
      <ol class="steps">
        <li>Откройте Google в новой вкладке и разрешите доступ.</li>
        <li>Скопируйте ссылку или код, который покажет Google.</li>
        <li>Вставьте ниже — система сама вытащит код.</li>
      </ol>
      <a class="btn btn-google" href="${startUrl}" target="_blank" rel="noopener noreferrer">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.059 36 24 36c-7.732 0-14-6.268-14-14s6.268-14 14-14c3.559 0 6.794 1.328 9.236 3.508l5.657-5.657C34.046 3.053 29.268 1 24 1 11.85 1 2 10.85 2 23s9.85 22 22 22 22-9.85 22-22c0-1.061-.076-2.099-.389-3.083z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c3.559 0 6.794 1.328 9.236 3.508l5.657-5.657C34.046 3.053 29.268 1 24 1 16.318 1 9.656 5.337 6.306 11.691z"/><path fill="#4CAF50" d="M24 45c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 45 24 45z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 46 30.196 46 24c0-1.341-.117-2.65-.389-3.917z"/></svg>
        Авторизация Google
      </a>
      <div class="divider">код доступа</div>
      <form method="POST" action="${action}">
        ${keyField}
        <label for="code">Код или ссылка от Google</label>
        <textarea id="code" name="code" placeholder="4/0AdkVLPw… или http://localhost/?code=4/0Adk…&scope=…" required autocomplete="off"></textarea>
        <p class="hint">Можно вставить целиком URL из адресной строки после авторизации — код извлечётся автоматически.</p>
        <button class="btn-submit" type="submit">Активировать доступ</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderSetupPage, escapeHtml };
