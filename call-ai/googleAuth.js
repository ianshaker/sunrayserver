// ============================================================================
// Общая авторизация Google для обработки звонков.
//
// Один сервис-аккаунт (GOOGLE_APPLICATION_CREDENTIALS_JSON) на обе задачи:
//   - Speech-to-Text (расшифровка)
//   - Vertex AI / Gemini (саммари)
// Используем уже установленный пакет googleapis, без тяжёлых SDK.
// ============================================================================

const { google } = require("googleapis");

let cachedCreds = null;
let cachedAuth = null;
let cachedSpeech = null;
let cachedAuthClient = null;

function hasCredentials() {
  return !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
}

function getCredentials() {
  if (cachedCreds) return cachedCreds;

  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON не задан");

  try {
    cachedCreds = JSON.parse(raw);
  } catch (e) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON: невалидный JSON");
  }
  return cachedCreds;
}

function getGoogleAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = new google.auth.GoogleAuth({
    credentials: getCredentials(),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return cachedAuth;
}

// Клиент Speech-to-Text v1p1beta1 (MP3 надёжнее, чем в v1).
function getSpeechClient() {
  if (cachedSpeech) return cachedSpeech;
  cachedSpeech = google.speech({ version: "v1p1beta1", auth: getGoogleAuth() });
  return cachedSpeech;
}

// Авторизованный HTTP-клиент (gaxios) для произвольных REST-вызовов Google (Vertex/Gemini).
async function getAuthClient() {
  if (cachedAuthClient) return cachedAuthClient;
  cachedAuthClient = await getGoogleAuth().getClient();
  return cachedAuthClient;
}

module.exports = { hasCredentials, getCredentials, getGoogleAuth, getSpeechClient, getAuthClient };
