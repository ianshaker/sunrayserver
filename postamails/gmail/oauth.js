const { google } = require("googleapis");
const { SCOPES } = require("../config");
const { getOAuthClientConfig } = require("./credentials");

function createOAuth2Client() {
  const { client_id, client_secret, redirect_uri } = getOAuthClientConfig();
  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
}

function generateAuthUrl() {
  const client = createOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
  return url;
}

async function exchangeCodeForTokens(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code.trim());
  client.setCredentials(tokens);
  return { tokens, client };
}

module.exports = {
  createOAuth2Client,
  generateAuthUrl,
  exchangeCodeForTokens,
};
