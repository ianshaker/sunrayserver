// ============================================================================
// Структурные обновления заявки при action=info_added.
//
// Разрешено: client_name, phone, city, detailed_address, dialog (через блок).
// Запрещено: address (Google Maps) — только через CRM.
// «Доп. телефон» → дописывается в phone через «, » (как в CRM).
// «Адрес» → всегда в detailed_address.
// ============================================================================

const { normalizePhone } = require("../postamails/parsing/phone");

/**
 * @typedef {{
 *   clientName?: string | null,
 *   phone?: string | null,
 *   extraPhone?: string | null,
 *   city?: string | null,
 *   detailedAddress?: string | null,
 *   dialogText?: string | null,
 * }} InfoUpdates
 */

function cleanStr(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

/**
 * Нормализует один или несколько телефонов в формат БД: 8(903)111-22-33[, 8(...)].
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function normalizePhoneList(value) {
  if (!value) return null;

  const parts = String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const normalized = [];
  for (const part of parts) {
    const formatted = normalizePhone(part) || part;
    if (formatted && !normalized.includes(formatted)) {
      normalized.push(formatted);
    }
  }

  return normalized.length ? normalized.join(", ") : null;
}

/**
 * Добавляет телефон к существующему списку через «, » без дублей.
 *
 * @param {string|null|undefined} existing
 * @param {string|null|undefined} additional
 * @returns {string|null}
 */
function appendPhoneToList(existing, additional) {
  const add = normalizePhone(additional) || cleanStr(additional);
  if (!add) return normalizePhoneList(existing);

  const base = normalizePhoneList(existing);
  if (!base) return add;

  const parts = base.split(", ").map((s) => s.trim());
  if (parts.includes(add)) return base;
  return `${base}, ${add}`;
}

/**
 * @param {object} appeal
 * @param {InfoUpdates} updates
 * @returns {string|null}
 */
function resolvePhoneValue(appeal, updates) {
  if (!updates.phone && !updates.extraPhone) return null;

  if (updates.phone && updates.extraPhone) {
    const main = normalizePhoneList(updates.phone);
    return appendPhoneToList(main, updates.extraPhone);
  }

  if (updates.extraPhone) {
    return appendPhoneToList(appeal.phone, updates.extraPhone);
  }

  return normalizePhoneList(updates.phone);
}

/** Менеджер просит менять основной адрес (Google Maps) — отклоняем. */
function wantsMainAddressUpdate(text) {
  const t = String(text || "").toLowerCase();
  if (/placeid|place_id|google\s*maps|гугл\s*карт/.test(t)) return true;
  if (/основн\w*\s+адрес|техн\w*\s+адрес|address\s*field/.test(t)) return true;
  if (/измен\w*\s+(?:основн\w*\s+)?адрес(?!\s*(?:детал|уточн))/.test(t)) return true;
  return false;
}

/**
 * Нормализует ответ Gemini / fast-path в InfoUpdates.
 *
 * @param {object|null} raw
 * @returns {InfoUpdates}
 */
function normalizeInfoUpdates(raw) {
  if (!raw || typeof raw !== "object") return {};

  const nested = raw.info_updates && typeof raw.info_updates === "object" ? raw.info_updates : raw;

  return {
    clientName: cleanStr(nested.client_name ?? nested.clientName),
    phone: normalizePhoneList(cleanStr(nested.phone ?? nested.main_phone)),
    extraPhone: normalizePhone(cleanStr(nested.extra_phone ?? nested.extraPhone ?? nested.additional_phone)),
    city: cleanStr(nested.city),
    detailedAddress: cleanStr(
      nested.detailed_address ?? nested.detailedAddress ?? nested.address_text,
    ),
    dialogText: cleanStr(nested.dialog_text ?? nested.dialogText ?? nested.info_text ?? raw.info_text),
  };
}

/** @param {InfoUpdates} updates */
function hasAnyInfoUpdate(updates) {
  return !!(
    updates.clientName ||
    updates.phone ||
    updates.extraPhone ||
    updates.city ||
    updates.detailedAddress ||
    updates.dialogText
  );
}

/**
 * @param {InfoUpdates} updates
 * @param {object} appeal — текущая заявка
 * @returns {{ client_name?, phone?, city?, detailed_address? }}
 */
function buildFieldPatch(appeal, updates) {
  /** @type {{ client_name?: string, phone?: string, city?: string, detailed_address?: string }} */
  const patch = {};

  if (updates.clientName) {
    patch.client_name = updates.clientName;
  }

  const phoneValue = resolvePhoneValue(appeal, updates);
  if (phoneValue) {
    patch.phone = phoneValue;
  }

  if (updates.city) {
    patch.city = updates.city;
  }
  if (updates.detailedAddress) {
    const existing = String(appeal.detailed_address || "").trim();
    patch.detailed_address = existing
      ? `${existing}\n${updates.detailedAddress}`
      : updates.detailedAddress;
  }

  return patch;
}

/**
 * Текст блока для дописывания в dialog (аудит + свободный текст + доп. тел).
 *
 * @param {string} managerLabel
 * @param {InfoUpdates} updates
 * @param {object} [appeal]
 * @returns {string|null}
 */
function buildDialogAppendBlock(managerLabel, updates, appeal = null) {
  const lines = [];

  if (updates.dialogText) lines.push(updates.dialogText);
  if (updates.clientName) lines.push(`Имя клиента: ${updates.clientName}`);

  const phoneValue = appeal ? resolvePhoneValue(appeal, updates) : null;
  if (phoneValue && (updates.phone || updates.extraPhone)) {
    lines.push(`Телефон: ${phoneValue}`);
  }

  if (updates.city) lines.push(`Город: ${updates.city}`);
  if (updates.detailedAddress) lines.push(`Детальный адрес: ${updates.detailedAddress}`);

  if (!lines.length) return null;

  return `\n\n---\n🤖 SUNRAY бот довнёс данные по просьбе менеджера (${managerLabel}):\n${lines.join("\n")}`;
}

/**
 * Строки для превью: что изменится в полях БД.
 *
 * @param {object} appeal
 * @param {InfoUpdates} updates
 * @returns {string[]}
 */
function buildPreviewChangeLines(appeal, updates) {
  const lines = [];
  const dash = "→";

  if (updates.clientName) {
    const cur = String(appeal.client_name || "").trim() || "—";
    lines.push(`Имя: ${cur} ${dash} ${updates.clientName}`);
  }

  const phoneValue = resolvePhoneValue(appeal, updates);
  if (phoneValue) {
    const cur = normalizePhoneList(appeal.phone) || String(appeal.phone || "").trim() || "—";
    lines.push(`Телефон: ${cur} ${dash} ${phoneValue}`);
  }

  if (updates.city) {
    const cur = String(appeal.city || "").trim() || "—";
    lines.push(`Город: ${cur} ${dash} ${updates.city}`);
  }
  if (updates.detailedAddress) {
    const cur = String(appeal.detailed_address || "").trim();
    if (cur) {
      lines.push(`Детальный адрес: допишем «${updates.detailedAddress}»`);
    } else {
      lines.push(`Детальный адрес: — ${dash} ${updates.detailedAddress}`);
    }
  }
  if (updates.dialogText) {
    lines.push(`В диалог: ${updates.dialogText}`);
  }

  return lines;
}

/**
 * Простой разбор структурированных полей без Gemini.
 *
 * @param {string} text
 * @returns {InfoUpdates|null}
 */
function extractInfoUpdatesFast(text) {
  const src = String(text || "");
  /** @type {InfoUpdates} */
  const updates = {};
  let matched = false;

  const nameMatch = src.match(
    /(?:имя\s*(?:клиента)?|клиент(?:а)?\s*(?:зовут|—|:))\s*[:—-]?\s*([^\n,;]+?)(?=\s*(?:,|;|\s+(?:тел|адрес|город|перенест|на\s+\d|доп)|$))/iu,
  );
  if (nameMatch) {
    updates.clientName = cleanStr(nameMatch[1]);
    matched = matched || !!updates.clientName;
  }

  const extraPhoneMatch = src.match(
    /(?:доп\.?\s*тел(?:ефон)?|ещ[ёе]\s*(?:один\s*)?тел(?:ефон)?)\s*[:—-]?\s*([\d\s()+-]{6,})/iu,
  );
  if (extraPhoneMatch) {
    updates.extraPhone = normalizePhone(cleanStr(extraPhoneMatch[1])) || cleanStr(extraPhoneMatch[1]);
    matched = matched || !!updates.extraPhone;
  }

  const phoneMatch = src.match(
    /(?<!(?:доп\.?\s*|ещ[ёe]\s*(?:один\s*)?))тел(?:ефон)?\s*[:—-]?\s*([\d\s()+-]{6,})/iu,
  );
  if (phoneMatch && !updates.extraPhone) {
    updates.phone = normalizePhone(cleanStr(phoneMatch[1])) || cleanStr(phoneMatch[1]);
    matched = matched || !!updates.phone;
  }

  const cityMatch = src.match(/город\s*[:—-]?\s*([^\n,;]+?)(?=\s*(?:,|;|\s+(?:адрес|тел|перенест)|$))/iu);
  if (cityMatch) {
    updates.city = cleanStr(cityMatch[1]);
    matched = matched || !!updates.city;
  }

  const addrMatch = src.match(
    /(?:детальн\w*\s*)?адрес\s*[:—-]?\s*([^\n]+?)(?=\s*(?:,|;|\s+(?:перенест|на\s+\d|тел|имя|город)|$))/iu,
  );
  if (addrMatch) {
    updates.detailedAddress = cleanStr(addrMatch[1]);
    matched = matched || !!updates.detailedAddress;
  }

  // Свободный текст после «инфо:» — только если не разобрали структурные поля
  const freeMatch = src.match(/(?:добав\w*|инфо|доп\.?\s*инфо)\s*[:—-]\s*(.+)$/isu);
  if (freeMatch && !matched) {
    let free = freeMatch[1].trim();
    free = free
      .replace(/#?\d{5}/g, " ")
      .replace(/\bсегодня\b/gi, " ")
      .replace(/(\d{1,2})(?:-го)?\s+[а-яё]+/gi, " ")
      .replace(/(\d{1,2})[./](\d{2})/g, " ")
      .replace(/перен[её]с\w*|перенест\w*|дедлайн/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (free.length >= 5) {
      updates.dialogText = free;
      matched = true;
    }
  }

  return matched ? updates : null;
}

function cleanAppealNumber(appealNumber) {
  return String(appealNumber || "").replace(/^#+/, "#");
}

/**
 * Собирает итоговую карточку для eventsnew (in-memory, без записи в appeals).
 *
 * @param {object} appeal
 * @param {InfoUpdates|null|undefined} updates
 * @param {string} managerLabel
 * @returns {object}
 */
function mergeAppealForLoading(appeal, updates, managerLabel) {
  const patch = buildFieldPatch(appeal, updates || {});
  const dialogAppend =
    updates && hasAnyInfoUpdate(updates)
      ? buildDialogAppendBlock(managerLabel, updates, appeal)
      : null;

  let dialog = String(appeal.dialog || "").trim();
  if (dialogAppend) {
    dialog = dialog ? dialog + dialogAppend : dialogAppend.trim();
  }

  const clientName = patch.client_name || String(appeal.client_name || "").trim() || "Без имени";

  return {
    appeal_number: cleanAppealNumber(appeal.appeal_number),
    client_name: clientName,
    phone: patch.phone ?? appeal.phone ?? "",
    city: patch.city ?? appeal.city ?? "",
    address: appeal.address ?? "",
    detailed_address: patch.detailed_address ?? appeal.detailed_address ?? null,
    dialog: dialog || null,
  };
}

module.exports = {
  wantsMainAddressUpdate,
  normalizeInfoUpdates,
  normalizePhoneList,
  resolvePhoneValue,
  hasAnyInfoUpdate,
  buildFieldPatch,
  buildDialogAppendBlock,
  buildPreviewChangeLines,
  extractInfoUpdatesFast,
  mergeAppealForLoading,
  cleanAppealNumber,
};
