const fs = require("fs");
const { CREDENTIALS_PATH } = require("../config");

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("Gmail credentials file not found.");
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
}

function getOAuthClientConfig() {
  const credentials = loadCredentials();
  const block = credentials.installed || credentials.web;
  if (!block) throw new Error("Invalid gmail-credentials.json format.");

  const { client_id, client_secret, redirect_uris } = block;
  const redirect_uri = redirect_uris[0];

  return { client_id, client_secret, redirect_uri };
}

module.exports = { loadCredentials, getOAuthClientConfig };
