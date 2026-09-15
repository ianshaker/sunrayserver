// ============================================================================
// Модуль «Дедлайны погрузки» — точка входа.
//
// server.js берёт модуль из трёх файлов (так же устроены входящие):
//   ./loading-deadlines           — startLoadingDeadlineWorker, registerLoadingDeadlineFastPath
//   ./loading-deadlines/callbacks — registerLoadingDeadlineCallbacks (превью команды),
//                                   registerLoadingDeadlineCardButtons (кнопки под карточкой)
//   ./loading-deadlines/digest    — registerLoadingDeadlineDigestButtons, startLoadingDeadlineDigest
//
//   registerIntent(require("./loading-deadlines/intent"));
//   registerIntent(require("./loading-deadlines/queryIntent"));
//   registerLoadingDeadlineFastPath();
//   // в onListen:
//   startLoadingDeadlineWorker(telegramBot);
//   startLoadingDeadlineDigest(telegramBot);
// ============================================================================

const { startLoadingDeadlineWorker } = require("./worker");
const { registerFastPath } = require("../assistant/fastPaths");
const { extractLoadingCardAppealNumber } = require("./messages");

/**
 * Основы слов команды в ответе на карточку. Один список на всё: по нему быстрый
 * путь и срабатывает, и проверяет конфликт слов с другими отделами.
 */
const REPLY_KEYWORDS = [
  "перенес", "перенос", "дедлайн", "отказ", "назнач", "замер",
  "тел", "телефон", "адрес", "диалог", "инфо", "добав", "входящ",
  "верн", "возврат", "обращен", "остав", "опис",
];
const REPLY_KEYWORD_RE = new RegExp(REPLY_KEYWORDS.join("|"), "i");

/**
 * Регистрирует fast-path роутера для этого отдела.
 * Вызывать ОДИН раз при старте сервера (после registerIntent).
 */
function registerLoadingDeadlineFastPath() {
  registerFastPath({
    name: "loading_deadline_reply",
    intent: "loading_deadline_manage",
    priority: 11,
    keywords: REPLY_KEYWORDS,
    detect: (text, replyText) => {
      if (!replyText) return null;

      const isLoadingDeadlineCard = extractLoadingCardAppealNumber(replyText) != null;
      if (!isLoadingDeadlineCard) return null;

      if (!REPLY_KEYWORD_RE.test(text)) return null;

      return {
        confidence: 0.96,
        reason: "Reply на карточку дедлайна погрузки",
      };
    },
  });
}

module.exports = {
  startLoadingDeadlineWorker,
  registerLoadingDeadlineFastPath,
};
