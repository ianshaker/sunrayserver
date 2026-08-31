// ============================================================================
// yandexmail/health/check — «подключись и покажи, что видишь».
//
// Ничего не заводит, никуда не пишет и наружу не отправляет. Нужна, чтобы
// человек одним запуском увидел: доступ есть, папка та, письма видны, режим
// чтения соблюдён.
// ============================================================================

const { describeSettings, isEnabled, listMissingSettings } = require("../config");
const { withReadOnlyMailbox } = require("../imap/client");
const { readMailboxState, fetchRecentHeaders } = require("../imap/fetch");
const { scanModuleForMutations } = require("../imap/guard");
const { describeWaiting } = require("../imap/authRetry");

/** Тема письма и отправитель — всё, что показываем. Тела в отчёте нет. */
function toPreview(header) {
  return {
    uid: header.uid,
    date: header.date,
    from: header.from,
    subject: String(header.subject || "").slice(0, 120),
    seen: header.seen,
  };
}

/**
 * Полная проверка. Никогда не бросает: любой отказ приходит объяснённым.
 * @param {{days?: number, limit?: number}} options
 */
async function runHealthCheck({ days = 1, limit = 5 } = {}) {
  const settings = describeSettings();
  const mutations = scanModuleForMutations();

  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    settings,
    readOnlyCodeScan: mutations.clean
      ? "чисто: команд изменения ящика в модуле нет"
      : `НАЙДЕНЫ команды изменения: ${mutations.findings.map((f) => `${f.file}:${f.command}`).join(", ")}`,
    mailbox: null,
    messages: [],
    problem: null,
    hint: null,
  };

  if (!mutations.clean) {
    report.problem = "в модуле появились команды изменения ящика";
    report.hint = "убрать их: модуль обязан оставаться только читающим";
    return report;
  }

  const missing = listMissingSettings();
  if (missing.length) {
    report.problem = `не заданы настройки: ${missing.join(", ")}`;
    report.hint = "владелец добавляет их в переменные окружения Render; пароль — только там";
    return report;
  }

  if (!isEnabled()) {
    report.problem = "модуль выключен рубильником YANDEX_IMAP_ENABLED";
    report.hint = "это нормально до начала проверки: проверка соединения запускается отдельно";
  }

  try {
    const result = await withReadOnlyMailbox(async (client) => {
      const mailbox = readMailboxState(client);
      const headers = await fetchRecentHeaders(client, { days, limit });
      return { mailbox, headers };
    });

    report.mailbox = result.mailbox;
    report.messages = result.headers.map(toPreview);
    report.ok = result.mailbox.readOnly === true;
    if (!report.ok) {
      report.problem = "папка открыта не в режиме чтения";
      report.hint = "работа прервана намеренно; без режима чтения модуль не работает";
    } else {
      report.problem = report.problem || null;
    }
    return report;
  } catch (error) {
    report.problem = error.message;
    if (error.kind === "auth") {
      report.hint =
        "Яндекс включает новый пароль приложения до двух-трёх часов; " +
        describeWaiting(1, Date.now());
    } else if (error.kind === "network") {
      report.hint = "сервер не достучался до почты: сеть или адрес узла";
    } else if (error.kind === "settings") {
      report.hint = "переменные окружения заданы не полностью";
    } else {
      report.hint = "смотреть текст ошибки выше";
    }
    return report;
  }
}

/** Человеческий вид отчёта — для лога и для запуска руками. */
function formatReport(report) {
  const lines = [];
  lines.push(`[yandexmail] проверка ${report.checkedAt}`);
  lines.push(`  рубильник: ${report.settings.enabled ? "включён" : "выключен"}, ` +
    `тень: ${report.settings.shadowMode ? "да" : "нет"}, ` +
    `режим чтения: ${report.settings.readOnly ? "да" : "НЕТ"}`);
  lines.push(`  узел: ${report.settings.host}:${report.settings.port}, ящик: ${report.settings.user}, ` +
    `папка: ${report.settings.mailbox}`);
  lines.push(`  пароль задан: ${report.settings.passwordSet ? "да" : "нет"}`);
  lines.push(`  проверка исходников: ${report.readOnlyCodeScan}`);

  if (report.mailbox) {
    lines.push(
      `  папка открыта: ${report.mailbox.path}, писем ${report.mailbox.exists}, ` +
        `поколение ${report.mailbox.uidValidity}, только чтение: ${report.mailbox.readOnly ? "да" : "НЕТ"}`,
    );
  }
  if (report.messages.length) {
    lines.push(`  последние письма (${report.messages.length}):`);
    for (const m of report.messages) {
      lines.push(`    #${m.uid} ${m.date || "?"} от ${m.from || "?"} — ${m.subject || "(без темы)"}` +
        `${m.seen === false ? " [непрочитано]" : ""}`);
    }
  }
  if (report.problem) lines.push(`  ПРОБЛЕМА: ${report.problem}`);
  if (report.hint) lines.push(`  что делать: ${report.hint}`);
  lines.push(`  итог: ${report.ok ? "связь есть, читаем только на чтение" : "не готово"}`);
  return lines.join("\n");
}

module.exports = { runHealthCheck, formatReport };
