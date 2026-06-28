function formatPhoneClassic(digits) {
  if (!digits) return "";
  digits = digits.replace(/^(\+7|7|8)/, "");
  if (digits.length !== 10) return digits;
  return `8(${digits.substring(0, 3)})${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) return formatPhoneClassic(digits);
  if (digits.length === 10) return formatPhoneClassic("8" + digits);
  return phone;
}

function extractPhone(text) {
  const match = text.match(
    /\+7\s*\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}/,
  );
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return formatPhoneClassic(digits);
}

module.exports = {
  formatPhoneClassic,
  normalizePhone,
  extractPhone,
};
