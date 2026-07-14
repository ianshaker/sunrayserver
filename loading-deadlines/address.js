// ============================================================================
// Гейт адреса/PlaceID для назначения замера из погрузки.
// Зеркало CRM validateAddressQuality + парсингАдреса.
// ============================================================================

/**
 * Парсит строку address: «… (PlaceID: xxx)» → чистый адрес + placeId.
 *
 * @param {string|null|undefined} fullAddress
 * @returns {{ address: string, placeId: string|null }}
 */
function parseAddressWithPlaceId(fullAddress) {
  const raw = String(fullAddress || "").trim();
  if (!raw) return { address: "", placeId: null };

  const placeIdMatch = raw.match(/\s*\(PlaceID:\s*([^)]+)\)/i);
  if (placeIdMatch) {
    const idx = raw.indexOf(" (PlaceID:");
    const address =
      idx >= 0 ? raw.substring(0, idx).trim() : raw.replace(placeIdMatch[0], "").trim();
    return { address, placeId: placeIdMatch[1].trim() || null };
  }

  return { address: raw, placeId: null };
}

/**
 * Проверяет, можно ли назначить замер (нужен PlaceID для топлива).
 *
 * @param {{ address?: string|null, place_id?: string|null }} event
 * @returns {{
 *   ok: boolean,
 *   cleanAddress: string,
 *   placeId: string|null,
 *   reason?: string,
 * }}
 */
function validateEventAddressForAssign(event) {
  const parsed = parseAddressWithPlaceId(event?.address);
  const placeId = parsed.placeId || (event?.place_id ? String(event.place_id).trim() : null) || null;
  const cleanAddress = parsed.address;

  if (!cleanAddress || cleanAddress.length < 5) {
    return {
      ok: false,
      cleanAddress: cleanAddress || "",
      placeId,
      reason:
        "У заявки нет корректного общего адреса. Внесите адрес с координатами через CRM (Погрузка → адрес) и повторите назначение.",
    };
  }

  if (!placeId) {
    return {
      ok: false,
      cleanAddress,
      placeId: null,
      reason:
        "У заявки нет общего адреса с координатами (PlaceID). Без него нельзя создать топливную запись. Внесите адрес через CRM-систему и повторите назначение замера.",
    };
  }

  return { ok: true, cleanAddress, placeId };
}

module.exports = {
  parseAddressWithPlaceId,
  validateEventAddressForAssign,
};
