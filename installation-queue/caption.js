const { CAPTION_MAX } = require("./config");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function statusEmoji(queueStatus) {
  if (queueStatus === "Заказ готов полностью") return "🟢";
  if (queueStatus === "Заказ частично готов") return "🟡";
  return "";
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
 * Require "N шт" so the name cannot stop on the first letter.
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
    const place = rest ? escapeHtml(rest) : "";
    const readyEsc = ready ? escapeHtml(ready) : "";

    const head = [`${n}. ${name}`, num ? `(${num})` : "", qty]
      .filter(Boolean)
      .join(" ");
    const meta = [place, readyEsc ? `до ${readyEsc}` : ""]
      .filter(Boolean)
      .join(" · ");
    return meta ? `${head} · ${meta}` : head;
  });
}

/**
 * HTML caption under first album photo (≤1024).
 * Classic parse_mode=HTML only — no Rich Message tables here.
 */
function formatInstallationCaption(data) {
  const {
    dogovorNumber,
    appealNumber,
    installationSum,
    factorySummary,
    queueStatus,
    comments,
  } = data;

  const emoji = statusEmoji(queueStatus);
  const number = escapeHtml(dogovorNumber || "Без номера");
  let appeal = "";
  if (appealNumber) {
    const normalized = String(appealNumber).replace(/^#+/, "#");
    appeal = ` ${escapeHtml(normalized)}`;
  }

  // Separate blockquotes with a blank line so Telegram doesn't glue them.
  const factoryQuotes = formatFactoryLines(factorySummary)
    .map((line) => `<blockquote>${line}</blockquote>`)
    .join("\n\n");

  const parts = [
    `<b>МОНТАЖ ${number}${appeal}</b>${emoji ? ` ${emoji}` : ""}`,
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
  statusEmoji,
  safeFilename,
  formatInstallationCaption,
  formatFactoryLines,
};
