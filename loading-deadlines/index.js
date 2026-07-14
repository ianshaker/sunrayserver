// ============================================================================
// Модуль «Дедлайны погрузки» — точка входа.
//
// Подключается в server.js:
//   const { startLoadingDeadlineWorker, registerLoadingDeadlineFastPath } = require("./loading-deadlines");
//   registerIntent(require("./loading-deadlines/intent"));
//   registerIntent(require("./loading-deadlines/queryIntent"));
//   registerLoadingDeadlineFastPath();
//   // в onListen:
//   startLoadingDeadlineWorker(telegramBot);
// ============================================================================

const { startLoadingDeadlineWorker, runDeadlineCheck } = require("./worker");
const { registerFastPath } = require("../assistant/fastPaths");

/**
 * Регистрирует fast-path роутера для этого отдела.
 * Вызывать ОДИН раз при старте сервера (после registerIntent).
 */
function registerLoadingDeadlineFastPath() {
  registerFastPath({
    name: "loading_deadline_reply",
    intent: "loading_deadline_manage",
    priority: 11,
    keywords: [
      "перенес", "перенос", "дедлайн", "отказ", "назнач", "замер",
      "тел", "телефон", "адрес", "диалог", "инфо", "добав", "входящ",
      "остав", "опис",
    ],
    detect: (text, replyText) => {
      if (!replyText) return null;

      const isLoadingDeadlineCard = /ДЕДЛАЙН\s+ПОГРУЗКИ/i.test(replyText);
      if (!isLoadingDeadlineCard) return null;

      if (
        !/перенес|перенос|дедлайн|отказ|назнач|замер|тел|телефон|адрес|диалог|инфо|добав|входящ|остав|опис/i.test(
          text,
        )
      ) {
        return null;
      }

      return {
        confidence: 0.96,
        reason: "Reply на карточку дедлайна погрузки",
      };
    },
  });
}

module.exports = {
  startLoadingDeadlineWorker,
  runDeadlineCheck,
  registerLoadingDeadlineFastPath,
};
