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

/** Turn "1 фабрика: Cortin (1006) 4 шт. На заводе Готовность: 17.07.2026" into compact lines. */
function formatFactoryLines(factorySummary) {
  const raw = String(factorySummary || "Нет информации о фабриках")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return raw.map((line) => {
    const m = line.match(
      /^(\d+)\s*фабрика:\s*(.+?)\s*(?:\((\s*[^)]+)\))?\s*(\d+\s*шт\.?)?\s*(.*?)(?:\s*Готовность:\s*(.+))?$/i,
    );
    if (!m) return escapeHtml(line);

    const n = m[1];
    const name = escapeHtml(m[2].trim());
    const num = m[3] ? escapeHtml(m[3].trim()) : "";
    const qty = m[4] ? escapeHtml(m[4].trim()) : "";
    const place = m[5] ? escapeHtml(m[5].trim()) : "";
    const ready = m[6] ? escapeHtml(m[6].trim()) : "";

    const head = [`${n}. ${name}`, num ? `(${num})` : "", qty]
      .filter(Boolean)
      .join(" ");
    const meta = [place, ready ? `до ${ready}` : ""].filter(Boolean).join(" · ");
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

  const factoryQuotes = formatFactoryLines(factorySummary)
    .map((line) => `<blockquote>${line}</blockquote>`)
    .join("\n");

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
