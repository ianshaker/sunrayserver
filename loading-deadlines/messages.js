// ============================================================================
// Форматирование Telegram-сообщений для модуля дедлайнов погрузки.
// ============================================================================

const { DIALOG_MAX_CHARS } = require("./config");

const MONTHS_RU = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatIsoDateHuman(isoDate) {
  if (!isoDate) return isoDate;
  const [, m, d] = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/) || [];
  if (!m || !d) return isoDate;
  return `${parseInt(d, 10)} ${MONTHS_RU[parseInt(m, 10) - 1]}`;
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeAppealNumber(appealNumber) {
  const raw = String(appealNumber || "").trim();
  if (!raw) return "—";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

const MEMO = `\
---
Чтобы закрыть этот дедлайн, отметьте @SUNRAYY_bot с номером заявки и укажите:
• перенести дедлайн на новую дату
• добавить инфо (телефон / адрес / диалог) и перенести дедлайн
• отказ
• назначить замер (мастер + дата + время)
• вернуть во входящие`;

/**
 * @param {object} event — строка eventsnew
 * @returns {{ text: string, parseMode: 'HTML' }}
 */
function formatDeadlineCard(event) {
  const lines = [];
  const num = normalizeAppealNumber(event.appeal_number);

  lines.push(`⏰ <b>ДЕДЛАЙН ПОГРУЗКИ ${escHtml(num)}</b>`);
  if (event.deadline) {
    lines.push(`📅 ${escHtml(formatIsoDateHuman(event.deadline))}`);
  }
  lines.push("");

  const name = (event.client_name || "").trim();
  const phone = (event.phone || "").trim();
  if (name || phone) {
    lines.push(`${escHtml(name)} ${escHtml(phone)}`.trim());
  }

  const city = (event.city || "").trim();
  if (city) {
    lines.push(`🏙 ${escHtml(city)}`);
  }

  const addr = (event.detailed_address || event.address || "").trim();
  if (addr) {
    lines.push(`📍 ${escHtml(addr)}`);
  }

  const note = (event.note || "").trim();
  if (note) {
    lines.push("");
    lines.push("📝 <b>Заметка:</b>");
    const truncated =
      note.length > DIALOG_MAX_CHARS
        ? note.slice(0, DIALOG_MAX_CHARS) + "…"
        : note;
    lines.push(escHtml(truncated));
  }

  const dialog = (event.dialog || "").trim();
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

function formatActionStub(appealNumber, action) {
  const num = escHtml(normalizeAppealNumber(appealNumber));
  const label = action || "это действие";

  return (
    `🧠 Пока не умею делать «${escHtml(label)}» автоматически для погрузки` +
    (num !== "—" ? ` по <b>${num}</b>` : "") +
    `.\n\n` +
    `Сейчас умею:\n` +
    `• переносить дедлайн\n` +
    `• обновлять телефон / детальный адрес / диалог вместе с переносом\n` +
    `• отправлять в отказ\n` +
    `• назначать замер мастеру\n` +
    `• возвращать во входящие\n\n` +
    `Остальное — вручную в CRM.`
  );
}

function formatEventNotFound(appealNumber) {
  return (
    `❌ Заявка ${escHtml(normalizeAppealNumber(appealNumber))} не найдена в погрузке.\n` +
    `Проверьте номер или что событие ещё со статусом «Погрузка».`
  );
}

function formatInvalidDate(reason) {
  return `⚠️ ${escHtml(reason || "Некорректная дата.")}`;
}

function formatMissingInfoUpdates(appealNumber) {
  const num = escHtml(normalizeAppealNumber(appealNumber));
  return (
    `⚠️ Не указано, что добавить по ${num}.\n` +
    `Можно: имя клиента, телефон, доп. тел, город, детальный адрес, текст в диалог.\n` +
    `Пример: <code>@SUNRAYY_bot ${num} добавить тел 8(903)111-22-33, перенести на 10 июля</code>\n` +
    `<i>Основной адрес Google Maps — только через CRM.</i>`
  );
}

function formatNeedsDeadlineResolution(appealNumber) {
  const num = escHtml(normalizeAppealNumber(appealNumber || "заявке"));
  return (
    `⚠️ Не могу закрыть дедлайн погрузки по <b>${num}</b> без решения.\n\n` +
    `Укажите перенос, отказ, возврат во входящие или назначение замера, например:\n` +
    `<code>@SUNRAYY_bot ${num} перенести на 10 июля</code>\n` +
    `<code>@SUNRAYY_bot ${num} отказ</code>\n` +
    `<code>@SUNRAYY_bot ${num} вернуть во входящие</code>\n` +
    `<code>@SUNRAYY_bot ${num} назначить на Антона завтра в 14:00</code>`
  );
}

function formatNoAddressForAssign(appealNumber, reason) {
  const num = escHtml(normalizeAppealNumber(appealNumber));
  return (
    `⚠️ Не могу назначить замер по <b>${num}</b>.\n\n` +
    `${escHtml(reason || "Нет общего адреса с координатами (PlaceID).")}\n\n` +
    `Внесите адрес через CRM (Погрузка → карандаш/адрес) и повторите команду.`
  );
}

function formatSlotBusy(message) {
  return `⚠️ ${escHtml(message || "Мастер занят в это время.")}`;
}

function formatAssignConfirm(appealNumber, master, dateHuman, startTime, endTime) {
  return (
    `✅ ${escHtml(normalizeAppealNumber(appealNumber))} назначена на замер.\n` +
    `Мастер: <b>${escHtml(master)}</b>\n` +
    `Дата: <b>${escHtml(dateHuman)}</b>\n` +
    `Время: <b>${escHtml(startTime)}–${escHtml(endTime)}</b>\n` +
    `Уведомление ушло в чат мастера.\n` +
    `Следующая карточка дедлайна появится в течение нескольких минут.`
  );
}

function formatAssignTelegramFailed(appealNumber) {
  return (
    `⚠️ Не удалось отправить уведомление мастеру по ${escHtml(normalizeAppealNumber(appealNumber))}.\n` +
    `Событие вернулось в погрузку. Попробуйте ещё раз или назначьте через CRM.`
  );
}

function formatRescheduleConfirm(appealNumber, newDateHuman) {
  return (
    `✅ Дедлайн погрузки по ${escHtml(normalizeAppealNumber(appealNumber))} ` +
    `перенесён на <b>${escHtml(newDateHuman)}</b>.\n` +
    `Следующая карточка появится в течение нескольких минут.`
  );
}

function formatAlreadyRejected(appealNumber) {
  return (
    `⚠️ ${escHtml(normalizeAppealNumber(appealNumber))} уже есть в отказах (appealsotkaz). ` +
    `Проверьте раздел «Отказы» в CRM.`
  );
}

function formatRejectConfirm(appealNumber) {
  return (
    `✅ ${escHtml(normalizeAppealNumber(appealNumber))} отправлена в <b>отказ</b>.\n` +
    `Событие удалено из погрузки.\n` +
    `Следующая карточка дедлайна появится в течение нескольких минут.`
  );
}

function formatAlreadyInAppeals(appealNumber) {
  return (
    `⚠️ ${escHtml(normalizeAppealNumber(appealNumber))} уже есть во входящих обращениях.\n` +
    `Сначала разберите дубль в CRM — иначе возврат из погрузки заблокирован.`
  );
}

function formatReturnAppealsConfirm(appealNumber) {
  return (
    `✅ ${escHtml(normalizeAppealNumber(appealNumber))} возвращена во <b>входящие</b>.\n` +
    `Событие удалено из погрузки.\n` +
    `Следующая карточка дедлайна появится в течение нескольких минут.`
  );
}

function buildPreviewDismissedMessage() {
  return "❌ Отменено. Действие не выполнено — пришлите команду заново при необходимости.";
}

/**
 * @param {{
 *   action: "reschedule" | "info_added" | "reject" | "assign_zamer" | "return_appeals",
 *   appealNumber: string,
 *   clientName?: string | null,
 *   phone?: string | null,
 *   rejectReason?: string | null,
 *   currentDeadlineHuman?: string | null,
 *   newDateHuman?: string | null,
 *   previewChangeLines?: string[] | null,
 *   infoUpdates?: object | null,
 *   master?: string | null,
 *   masterAssumed?: boolean,
 *   dateHuman?: string | null,
 *   startTime?: string | null,
 *   endTime?: string | null,
 *   cleanAddress?: string | null,
 * }} draft
 */
function buildPreviewMessage(draft) {
  if (draft.action === "return_appeals") {
    const lines = [
      `↩️ Вернуть ${escHtml(normalizeAppealNumber(draft.appealNumber))} из погрузки во <b>входящие</b>?`,
      "---",
      `Клиент: ${escHtml(String(draft.clientName || "Без имени").trim())}`,
      `Телефон: ${escHtml(String(draft.phone || "—").trim() || "—")}`,
      "",
      "Будет создана активная заявка во входящих (как в CRM).",
      "⚠️ <b>Событие будет удалено из погрузки</b>.",
      "---",
      "Нажмите «Сохранить» или «Отменить».",
    ];
    return { text: lines.join("\n"), parseMode: "HTML" };
  }

  if (draft.action === "reject") {
    const lines = [
      `❌ Отправить ${escHtml(normalizeAppealNumber(draft.appealNumber))} из погрузки в <b>отказ</b>?`,
      "---",
      `Клиент: ${escHtml(String(draft.clientName || "Без имени").trim())}`,
      `Телефон: ${escHtml(String(draft.phone || "—").trim() || "—")}`,
    ];

    const reason = String(draft.rejectReason || "").trim();
    lines.push(`Причина: ${reason ? escHtml(reason) : "— не указана"}`);
    lines.push("");
    lines.push(
      "⚠️ <b>Событие будет удалено из погрузки</b> и появится в разделе «Отказы».",
    );
    lines.push("---");
    lines.push("Нажмите «Сохранить» или «Отменить».");
    return { text: lines.join("\n"), parseMode: "HTML" };
  }

  if (draft.action === "assign_zamer") {
    const lines = [
      `👷 Назначить замер ${escHtml(normalizeAppealNumber(draft.appealNumber))}?`,
      "---",
      `Клиент: ${escHtml(String(draft.clientName || "Без имени").trim())}`,
      `Телефон: ${escHtml(String(draft.phone || "—").trim() || "—")}`,
    ];
    if (draft.cleanAddress) {
      lines.push(`Адрес: ${escHtml(draft.cleanAddress)}`);
    }
    lines.push("");
    lines.push(`Мастер: <b>${escHtml(draft.master)}</b>`);
    if (draft.masterAssumed) {
      lines.push("<i>Имя мастера уточнил по смыслу — проверьте.</i>");
    }
    lines.push(`Дата: <b>${escHtml(draft.dateHuman)}</b>`);
    lines.push(`Время: <b>${escHtml(draft.startTime)}–${escHtml(draft.endTime)}</b> <i>(слот 1 час)</i>`);
    lines.push("");
    lines.push("Будет создана топливная запись и отправлено уведомление в чат мастера.");
    lines.push("Событие сменит статус Погрузка → Замер.");
    lines.push("---");
    lines.push("Нажмите «Сохранить» или «Отменить».");
    return { text: lines.join("\n"), parseMode: "HTML" };
  }

  const heading =
    draft.action === "info_added"
      ? `📝 Добавить инфо и перенести дедлайн погрузки ${escHtml(normalizeAppealNumber(draft.appealNumber))}?`
      : `⏰ Перенести дедлайн погрузки ${escHtml(normalizeAppealNumber(draft.appealNumber))}?`;

  const lines = [heading, "---"];

  if (draft.clientName) {
    lines.push(`Клиент сейчас: ${escHtml(String(draft.clientName).trim() || "—")}`);
  }
  if (draft.currentDeadlineHuman) {
    lines.push(`Дедлайн сейчас: ${escHtml(draft.currentDeadlineHuman)}`);
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
    if (draft.infoUpdates?.detailedAddress) {
      lines.push("");
      lines.push(
        "<i>Адрес из команды обновлю в «детальный адрес». " +
          "Основной адрес с координатами (Google Maps) — только через CRM.</i>",
      );
    }
  }

  lines.push("---");
  lines.push("Нажмите «Сохранить» или «Отменить».");
  return { text: lines.join("\n"), parseMode: "HTML" };
}

module.exports = {
  formatDeadlineCard,
  formatActionStub,
  formatEventNotFound,
  formatInvalidDate,
  formatMissingInfoUpdates,
  formatNeedsDeadlineResolution,
  formatNoAddressForAssign,
  formatSlotBusy,
  formatAssignConfirm,
  formatAssignTelegramFailed,
  formatRescheduleConfirm,
  formatAlreadyRejected,
  formatRejectConfirm,
  formatAlreadyInAppeals,
  formatReturnAppealsConfirm,
  buildPreviewMessage,
  buildPreviewDismissedMessage,
  formatIsoDateHuman,
  escHtml,
  normalizeAppealNumber,
};
