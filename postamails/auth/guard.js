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
  // Без секрета страница открыта — только для внутреннего использования по ссылке из TG.
  if (!GMAIL_SETUP_SECRET) return true;
  return key === GMAIL_SETUP_SECRET;
}

function rejectUnauthorized(reply) {
  return reply.code(403).type("text/html").send("<h1>403 Forbidden</h1>");
}

function guardSetupAccess(request, reply) {
  if (!isSetupKeyValid(extractSetupKey(request))) {
    return rejectUnauthorized(reply);
  }
  return null;
}

function appendSetupKey(path, key) {
  const url = `${PUBLIC_BASE_URL}${path}`;
  if (!key) return url;
  return `${url}?key=${encodeURIComponent(key)}`;
}

module.exports = {
  extractSetupKey,
  isSetupKeyValid,
  guardSetupAccess,
  appendSetupKey,
  PUBLIC_BASE_URL,
  SETUP_PATH,
  START_PATH,
  EXCHANGE_PATH,
};
