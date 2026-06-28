const { google } = require("googleapis");
const { createOAuth2Client } = require("./oauth");
const { readToken, ensureCacheFile } = require("./tokenStore");

let gmailClient = null;
let activeOAuth2Client = null;

async function initGmailClient() {
  const token = readToken();
  if (!token) {
    throw new Error("No Gmail token found. Authorize via /gmail/setup first.");
  }

  activeOAuth2Client = createOAuth2Client();
  activeOAuth2Client.setCredentials(token);
  gmailClient = google.gmail({ version: "v1", auth: activeOAuth2Client });
  ensureCacheFile();
  console.log("[postamails] Gmail API client initialized.");
}

function getGmailClient() {
  if (!gmailClient) {
    throw new Error("Gmail client is not initialized.");
  }
  return gmailClient;
}

async function reloadGmailClientAfterTokenSave(tokens) {
  activeOAuth2Client = createOAuth2Client();
  activeOAuth2Client.setCredentials(tokens);
  gmailClient = google.gmail({ version: "v1", auth: activeOAuth2Client });
  ensureCacheFile();
}

module.exports = {
  initGmailClient,
  getGmailClient,
  reloadGmailClientAfterTokenSave,
};
