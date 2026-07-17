const { CAPTION_MAX } = require("./config");

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Per-factory place emoji (not queue status). */
function placeEmoji(place) {
  const p = String(place || "").toLowerCase();
  if (p.includes("склад")) return "🟢";
  if (p.includes("завод")) return "🟡";
  return "⚪";
}

/** "22.07.2026" / "2026-07-22" → "22 июля" */
function formatReadyDateRu(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";

  let day;
  let month; // 1-12
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (dmy) {
    day = parseInt(dmy[1], 10);
    month = parseInt(dmy[2], 10);
  } else {
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) {
      day = parseInt(ymd[3], 10);
      month = parseInt(ymd[2], 10);
    }
  }

  if (!day || !month || month < 1 || month > 12) {
    return escapeHtml(s);
  }
  return `${day} ${MONTHS_RU[month - 1]}`;
}

function safeFilename(dogovorNumber) {
  const base = String(dogovorNumber || "dogovor")
    .trim()
    .replace(/[^\w.\-А-Яа-яЁё ]+/gi, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return `${base || "dogovor"}.pdf`;
}

/**
 * "1 фабрика: Cortin (1006) 4 шт. На заводе Готовность: 17.07.2026"
 * → "1. Cortin (1006) 4 шт. · 🟡 На заводе · 17 июля"
 */
function formatFactoryLines(factorySummary) {
  const raw = String(factorySummary || "Нет информации о фабриках")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return raw.map((line) => {
    const m = line.match(
      /^(\d+)\s*фабрика:\s*(.+?)\s*(?:\(([^)]+)\))?\s+(\d+)\s*шт\.?\s*(.*)$/i,
    );
    if (!m) return escapeHtml(line);

    const n = m[1];
    const name = escapeHtml(m[2].trim());
    const num = m[3] ? escapeHtml(m[3].trim()) : "";
    const qty = `${escapeHtml(m[4])} шт.`;
    let rest = (m[5] || "").trim();
    let ready = "";
    const readyMatch = rest.match(/^(.*?)(?:\s*Готовность:\s*(.+))$/i);
    if (readyMatch) {
      rest = readyMatch[1].trim();
      ready = readyMatch[2].trim();
    }

    const placeRaw = rest;
    const place = placeRaw ? escapeHtml(placeRaw) : "";
    const emoji = placeRaw ? placeEmoji(placeRaw) : "";
    const readyRu = ready ? formatReadyDateRu(ready) : "";

    const head = [`${n}. ${name}`, num ? `(${num})` : "", qty]
      .filter(Boolean)
      .join(" ");
    const placePart = place ? `${emoji ? `${emoji} ` : ""}${place}` : "";
    const meta = [placePart, readyRu].filter(Boolean).join(" · ");
    return meta ? `${head} · ${meta}` : head;
  });
}

/**
 * HTML caption under first album photo (≤1024).
 *
 * МОНТАЖ МСК 11975 #07993
 * Солнечногорск
 * 8(925)067-90-86
 * 1 500 ₽
 * <blockquote>1. Inter … · 🟡 На заводе · 23 июля</blockquote>
 */
function formatInstallationCaption(data) {
  const {
    dogovorNumber,
    appealNumber,
    city,
    phone,
    installationSum,
    factorySummary,
    comments,
  } = data;

  const number = escapeHtml(dogovorNumber || "Без номера");
  let appeal = "";
  if (appealNumber) {
    const normalized = String(appealNumber).replace(/^#+/, "#");
    appeal = ` ${escapeHtml(normalized)}`;
  }

  const factoryQuotes = formatFactoryLines(factorySummary)
    .map((line) => `<blockquote>${line}</blockquote>`)
    .join("\n\n");

  const parts = [
    `<b>МОНТАЖ ${number}${appeal}</b>`,
    escapeHtml(city || "Не указан"),
    escapeHtml(phone || "Не указан"),
    escapeHtml(installationSum || "Не указана"),
    factoryQuotes,
  ];

  const note = comments && String(comments).trim();
  if (note) {
    parts.push(`⚠️ ${escapeHtml(note)}`);
  }

  let caption = parts.join("\n");
  if (caption.length > CAPTION_MAX) {
    caption = `${caption.slice(0, CAPTION_MAX - 1)}…`;
  }
  return caption;
}

module.exports = {
  escapeHtml,
  placeEmoji,
  formatReadyDateRu,
  safeFilename,
  formatInstallationCaption,
  formatFactoryLines,
};
