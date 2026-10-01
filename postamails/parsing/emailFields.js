const { PRODUCT_KEYWORDS } = require("../config");
const { parseEmailFields, pickField } = require("./fields");

/**
 * Ищет название из справочника внутри строки, не глядя на регистр.
 *
 * Берётся **самое длинное** совпадение, а не первое: «Деревянные жалюзи» содержат и «Жалюзи»,
 * и до 22.09.2026 форма с сайта записывалась общим словом — вид изделия терялся на входе.
 */
function matchProductKeyword(value) {
  const low = String(value || "").toLowerCase();
  const sovpavshie = PRODUCT_KEYWORDS.filter((p) => low.includes(p.toLowerCase()));
  if (sovpavshie.length === 0) return null;
  return sovpavshie.reduce((a, b) => (b.length > a.length ? b : a));
}

function extractName(text) {
  return pickField(parseEmailFields(text), "имя", "ваше имя");
}

function extractCity(text) {
  return pickField(parseEmailFields(text), "город") || "Без города";
}

function extractProduct(text) {
  // Форма прислала продукт явно — он важнее любых слов в тексте письма. Но в «Тип продукта» идёт только вид изделия
  // из справочника: поле без него — ткань или модель («Лен Dimout Бежевый 83023 (Однотонные ткани)», «Горизонтальные
  // Лента 7525»), и в карточке оно стало бы пунктом, которого нет в списке (01.10.2026, #010037). Само поле не
  // теряется — письмо целиком лежит в диалоге карточки.
  const declared = pickField(parseEmailFields(text), "продукт", "товар");
  if (declared) return matchProductKeyword(declared) || "Продукт не указан";

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
