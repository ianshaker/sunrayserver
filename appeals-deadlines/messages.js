// ============================================================================
// Форматирование Telegram-сообщений для модуля дедлайнов входящих.
// ============================================================================

const { DIALOG_MAX_CHARS } = require("./config");

const MEMO = `\
---
Чтобы закрыть этот дедлайн, отметьте @SUNRAYY_bot с номером заявки и укажите:
• перенести дедлайн
• добавить доп. инфо и перенести дедлайн
• кинуть в погрузку
• отказ`;

/**
 * Форматирует карточку дедлайна для отправки в Telegram (HTML).
 *
 * @param {object} appeal
 * @returns {{ text: string, parseMode: 'HTML' }}
 */
function formatDeadlineCard(appeal) {
  const lines = [];

  lines.push(`⏰ <b>ДЕДЛАЙН ${escHtml(appeal.appeal_number)}</b>`);
  lines.push("");

  const name = (appeal.client_name || "").trim();
  const phone = (appeal.phone || "").trim();
  if (name || phone) {
    lines.push(`${escHtml(name)} ${escHtml(phone)}`.trim());
  }

  const city = (appeal.city || "").trim();
  if (city) {
    lines.push(`🏙 ${escHtml(city)}`);
  }

  const addr = (appeal.detailed_address || appeal.address || "").trim();
  if (addr) {
    lines.push(`📍 ${escHtml(addr)}`);
  }

  const dialog = (appeal.dialog || "").trim();
  if (dialog) {
    lines.push("");
    lines.push("💬 <b>Диалог:</b>");
    const truncated =
      dialog.length > DIALOG_MAX_CHARS
        ? dialog.slice(0, DIALOG_MAX_CHARS) + "…"
        : dialog;
    lines.push(escHtml(truncated));
  }

  lines.push("");
  lines.push(MEMO);

  return {
    text: lines.join("\n"),
    parseMode: "HTML",
  };
}

/**
 * Форматирует подтверждение переноса дедлайна.
 *
 * @param {string} appealNumber
 * @param {string} newDateHuman  напр. «10 июля»
 */
function formatRescheduleConfirm(appealNumber, newDateHuman) {
  return `✅ Дедлайн по ${escHtml(appealNumber)} перенесён на <b>${escHtml(newDateHuman)}</b>.\nСледующая заявка появится в течение нескольких минут.`;
}

/** Заглушка для неимплементированных действий. */
function formatNotImplemented(action) {
  const labels = {
    reject: "отказ",
    loading: "погрузка",
    info_added: "добавить инфо",
  };
  const label = labels[action] || action;
  return `⚠️ Действие «${escHtml(label)}» пока не реализовано в боте. Выполните его вручную в CRM.`;
}

/** Заявка не найдена. */
function formatAppealNotFound(appealNumber) {
  return `❌ Заявка ${escHtml(appealNumber)} не найдена в базе.`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = {
  formatDeadlineCard,
  formatRescheduleConfirm,
  formatNotImplemented,
  formatAppealNotFound,
};
