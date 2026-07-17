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

/** HTML caption under the PDF (≤1024). */
function formatInstallationCaption(data) {
  const {
    dogovorNumber,
    appealNumber,
    city,
    phone,
    installationSum,
    factorySummary,
    queueStatus,
    documents,
    comments,
  } = data;

  const emoji = statusEmoji(queueStatus);
  const number = escapeHtml(dogovorNumber || "Без номера");
  let appeal = "";
  if (appealNumber) {
    const normalized = String(appealNumber).replace(/^#+/, "#");
    appeal = ` (${escapeHtml(normalized)})`;
  }

  const lines = [
    `<b>Договор ${number}</b>${appeal}${emoji ? ` ${emoji}` : ""}`,
    escapeHtml(city || "Не указан"),
    `<code>${escapeHtml(phone || "Не указан")}</code>`,
    `Сумма установки: <b>${escapeHtml(installationSum || "Не указана")}</b>`,
    "———",
  ];

  const factories = String(factorySummary || "Нет информации о фабриках")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of factories) {
    lines.push(escapeHtml(line));
  }

  const docs = documents && String(documents).trim();
  if (docs && docs.toLowerCase() !== "нет") {
    lines.push("———");
    lines.push("<b>Закрывающие документы</b>");
    lines.push(escapeHtml(docs));
  }

  const note = comments && String(comments).trim();
  if (note) {
    lines.push("———");
    lines.push(`⚠️ ${escapeHtml(note)}`);
  }

  let caption = lines.join("\n");
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
};
