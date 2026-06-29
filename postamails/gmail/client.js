const { google } = require("googleapis");
const { createOAuth2Client } = require("./oauth");
const { readToken, writeToken, ensureCacheFile } = require("./tokenStore");

let gmailClient = null;
let activeOAuth2Client = null;

function buildClient(token) {
  activeOAuth2Client = createOAuth2Client();
  activeOAuth2Client.setCredentials(token);

  // Google сам обновляет access_token по refresh_token — сохраняем свежий токен обратно.
  activeOAuth2Client.on("tokens", (newTokens) => {
    const merged = { ...token, ...newTokens };
    writeToken(merged).catch((e) =>
      console.error("[postamails] сохранение обновлённого токена:", e.message),
    );
  });

  gmailClient = google.gmail({ version: "v1", auth: activeOAuth2Client });
  ensureCacheFile();
}

async function initGmailClient() {
  const token = await readToken();
  if (!token) {
    throw new Error("No Gmail token found. Authorize via /gmail/setup first.");
  }
  buildClient(token);
  console.log("[postamails] Gmail API client initialized.");
}

// Ленивый доступ: если клиента нет — пытаемся поднять его из сохранённого токена.
// Так любой инстанс Render подхватывает токен из Supabase после активации (без рестарта).
async function ensureGmailClient() {
  if (gmailClient) return gmailClient;
  await initGmailClient();
  return gmailClient;
}

function getGmailClient() {
  if (!gmailClient) {
    throw new Error("Gmail client is not initialized.");
  }
  return gmailClient;
}

async function reloadGmailClientAfterTokenSave(tokens) {
  buildClient(tokens);
}

module.exports = {
  initGmailClient,
  getGmailClient,
  ensureGmailClient,
  reloadGmailClientAfterTokenSave,
};
