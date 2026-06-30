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

function formatInvalidDate(reason) {
  return `⚠️ ${escHtml(reason || "Некорректная дата.")}`;
}

function formatMissingInfoUpdates(appealNumber) {
  return (
    `⚠️ Не указано, что добавить по ${escHtml(appealNumber)}.\n` +
    `Можно: имя клиента, телефон, доп. тел (→ в phone через запятую), город, адрес (→ детальный), текст в диалог.\n` +
    `Пример: <code>@SUNRAYY_bot ${escHtml(appealNumber)} добавить инфо: имя клиента Иван, адрес ул. Ленина 5, перенести на 10 июля</code>\n` +
    `<i>Основной адрес Google Maps — только через CRM.</i>`
  );
}

function formatAlreadyInLoading(appealNumber) {
  return `⚠️ ${escHtml(appealNumber)} уже есть в погрузке (eventsnew). Проверьте отдел «Погрузка» в CRM.`;
}

function formatAlreadyRejected(appealNumber) {
  return `⚠️ ${escHtml(appealNumber)} уже есть в отказах (appealsotkaz). Проверьте раздел «Отказы» в CRM.`;
}

function formatRejectConfirm(appealNumber) {
  return (
    `✅ ${escHtml(appealNumber)} отправлена в <b>отказ</b>.\n` +
    `Заявка удалена из входящих.\n` +
    `Следующая карточка дедлайна появится в течение нескольких минут.`
  );
}

function formatLoadingConfirm(appealNumber, { telegramSent } = {}) {
  let text =
    `✅ ${escHtml(appealNumber)} отправлена в <b>погрузку</b>.\n` +
    `Заявка удалена из входящих.\n` +
    `Следующая карточка дедлайна появится в течение нескольких минут.`;
  if (telegramSent === false) {
    text += "\n⚠️ Уведомление в чат погрузки не отправилось — проверьте в CRM.";
  }
  return text;
}

function buildPreviewDismissedMessage() {
  return "❌ Отменено. Действие не выполнено — пришлите команду заново при необходимости.";
}

/**
 * @param {{
 *   action: "reschedule" | "info_added" | "loading" | "reject",
 *   appealNumber: string,
 *   clientName?: string | null,
 *   phone?: string | null,
 *   rejectReason?: string | null,
 *   currentReminderHuman?: string | null,
 *   newDateHuman?: string | null,
 *   previewChangeLines?: string[] | null,
 *   loadingSnapshot?: object | null,
 *   salemanager?: string | null,
 *   managerLabel?: string | null,
 * }} draft
 */
function buildPreviewMessage(draft) {
  if (draft.action === "reject") {
    const lines = [
      `❌ Отправить ${escHtml(draft.appealNumber)} в <b>отказ</b>?`,
      "---",
      `Клиент: ${escHtml(String(draft.clientName || "Без имени").trim())}`,
      `Телефон: ${escHtml(String(draft.phone || "—").trim() || "—")}`,
    ];

    const reason = String(draft.rejectReason || "").trim();
    lines.push(`Причина: ${reason ? escHtml(reason) : "— не указана"}`);
    lines.push("");
    lines.push(
      "⚠️ <b>Заявка будет удалена из входящих</b> и появится в разделе «Отказы».",
    );
    lines.push("---");
    lines.push("Нажмите «Сохранить» или «Отменить».");
    return { text: lines.join("\n"), parseMode: "HTML" };
  }

  if (draft.action === "loading") {
    const snap = draft.loadingSnapshot || {};
    const lines = [
      `📦 Отправить ${escHtml(draft.appealNumber)} в <b>погрузку</b>?`,
      "---",
      `Клиент: ${escHtml(String(snap.client_name || "Без имени").trim())}`,
      `Телефон: ${escHtml(String(snap.phone || "—").trim() || "—")}`,
    ];

    if (snap.city) lines.push(`Город: ${escHtml(String(snap.city).trim())}`);
    const addr = String(snap.detailed_address || snap.address || "").trim();
    if (addr) lines.push(`Адрес: ${escHtml(addr)}`);

    const dialog = String(snap.dialog || "").trim();
    if (dialog) {
      const short =
        dialog.length > 400 ? dialog.slice(0, 400) + "…" : dialog;
      lines.push("");
      lines.push("💬 <b>Диалог:</b>");
      lines.push(escHtml(short));
    }

    const changeLines = draft.previewChangeLines || [];
    if (changeLines.length) {
      lines.push("");
      lines.push("📋 <b>Довнесём перед отправкой:</b>");
      for (const line of changeLines) {
        lines.push(escHtml(line));
      }
    }

    lines.push("");
    lines.push(`Менеджер вывода: <b>${escHtml(draft.salemanager || "—")}</b>`);
    lines.push("");
    lines.push("⚠️ <b>Заявка будет удалена из входящих</b> и появится в отделе «Погрузка».");
    lines.push("<i>Основной адрес (Google Maps) не меняем — только через CRM.</i>");
    lines.push("---");
    lines.push("Нажмите «Сохранить» или «Отменить».");
    return { text: lines.join("\n"), parseMode: "HTML" };
  }

  const heading =
    draft.action === "info_added"
      ? `📝 Добавить инфо и перенести дедлайн ${escHtml(draft.appealNumber)}?`
      : `⏰ Перенести дедлайн ${escHtml(draft.appealNumber)}?`;

  const lines = [heading, "---"];

  if (draft.clientName) {
    lines.push(`Клиент сейчас: ${escHtml(String(draft.clientName).trim() || "—")}`);
  }
  if (draft.currentReminderHuman) {
    lines.push(`Дедлайн сейчас: ${escHtml(draft.currentReminderHuman)}`);
  }
  lines.push(`Новый дедлайн: ${escHtml(draft.newDateHuman)}`);

  if (draft.action === "info_added") {
    lines.push("");
    lines.push("📋 <b>Изменения:</b>");
    const changeLines = draft.previewChangeLines || [];
    if (changeLines.length) {
      for (const line of changeLines) {
        lines.push(escHtml(line));
      }
    } else {
      lines.push("—");
    }
    lines.push("");
    lines.push("<i>Адрес из команды → в детальный адрес. Основной адрес (Google Maps) не меняем.</i>");
  }

  lines.push("---");
  lines.push("Нажмите «Сохранить» или «Отменить».");
  return { text: lines.join("\n"), parseMode: "HTML" };
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
  formatInvalidDate,
  formatMissingInfoUpdates,
  formatAlreadyInLoading,
  formatAlreadyRejected,
  formatRejectConfirm,
  formatLoadingConfirm,
  buildPreviewMessage,
  buildPreviewDismissedMessage,
};
