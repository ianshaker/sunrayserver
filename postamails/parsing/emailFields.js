const { PRODUCT_KEYWORDS } = require("../config");

function extractName(text) {
  const match =
    text.match(/Имя:\s*(.+)/i) || text.match(/Ваше имя:\s*(.+)/i);
  return match ? match[1].trim() : "";
}

function extractCity(text) {
  const match = text.match(/Город:\s*(.+)/i);
  return match ? match[1].trim() : "Без города";
}

function extractProduct(text) {
  const found = PRODUCT_KEYWORDS.find((p) => text.includes(p));
  return found || "Продукт не указан";
}

function extractEmailBodyFromPayload(payload) {
  let body = "";
  if (payload.parts) {
    const textPart =
      payload.parts.find((p) => p.mimeType === "text/plain") ||
      payload.parts.find((p) => p.mimeType === "text/html");
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, "base64").toString("utf8");
    }
  } else if (payload.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf8");
  }
  return body;
}

module.exports = {
  extractName,
  extractCity,
  extractProduct,
  extractEmailBodyFromPayload,
};
