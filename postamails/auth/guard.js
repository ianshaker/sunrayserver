const {
  GMAIL_SETUP_SECRET,
  PUBLIC_BASE_URL,
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
} = require("../config");

function extractSetupKey(request) {
  return (
    request.query?.key ||
    request.body?.key ||
    request.headers["x-gmail-setup-key"] ||
    ""
  );
}

function isSetupKeyValid(key) {
  if (!GMAIL_SETUP_SECRET) return false;
  return key === GMAIL_SETUP_SECRET;
}

function rejectUnauthorized(reply) {
  if (!GMAIL_SETUP_SECRET) {
    return reply
      .code(503)
      .type("text/html")
      .send(
        "<h1>Gmail setup disabled</h1><p>Set GMAIL_SETUP_SECRET on Render.</p>",
      );
  }
  return reply.code(403).type("text/html").send("<h1>403 Forbidden</h1>");
}

function guardSetupAccess(request, reply) {
  if (!isSetupKeyValid(extractSetupKey(request))) {
    return rejectUnauthorized(reply);
  }
  return null;
}

module.exports = {
  extractSetupKey,
  isSetupKeyValid,
  guardSetupAccess,
  PUBLIC_BASE_URL,
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
};
