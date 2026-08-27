const { PRODUCT_KEYWORDS } = require("../config");
const { parseEmailFields, pickField } = require("./fields");

/** Ищет название из справочника внутри строки, не глядя на регистр. */
function matchProductKeyword(value) {
  const low = String(value || "").toLowerCase();
  return PRODUCT_KEYWORDS.find((p) => low.includes(p.toLowerCase())) || null;
}

function extractName(text) {
  return pickField(parseEmailFields(text), "имя", "ваше имя");
}

function extractCity(text) {
  return pickField(parseEmailFields(text), "город") || "Без города";
}

function extractProduct(text) {
  // Форма прислала продукт явно — он важнее любых слов в тексте письма.
  const declared = pickField(parseEmailFields(text), "продукт", "товар");
  if (declared) return matchProductKeyword(declared) || declared;

  return matchProductKeyword(text) || "Продукт не указан";
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
