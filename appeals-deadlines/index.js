// ============================================================================
// Модуль «Дедлайны входящих» — точка входа.
//
// Подключается в server.js:
//   const { startAppealDeadlineWorker, registerDeadlineFastPath } = require("./appeals-deadlines");
//   registerIntent(require("./appeals-deadlines/intent"));
//   registerDeadlineFastPath();
//   // в onListen:
//   startAppealDeadlineWorker(telegramBot);
// ============================================================================

const { startAppealDeadlineWorker, runDeadlineCheck } = require("./worker");
const { registerFastPath } = require("../assistant/fastPaths");

/**
 * Регистрирует fast-path роутера для этого отдела.
 * Вызывать ОДИН раз при старте сервера (после registerIntent).
 */
function registerDeadlineFastPath() {
  registerFastPath({
    name: "deadline_reply",
    intent: "appeal_deadline_manage",
    priority: 10,
    // Слова, на которые реагирует это правило в тексте команды.
    // При добавлении нового отдела — сюда смотреть в первую очередь на предмет конфликта.
    keywords: ["перенес", "перенос", "дедлайн", "отказ", "погруз", "инфо", "замер"],
    detect: (text, replyText) => {
      if (!replyText) return null;

      const isDeadlineCard =
        /ДЕДЛАЙН\s*#?\d{5}/i.test(replyText) || /#\d{5}/.test(replyText);
      if (!isDeadlineCard) return null;

      if (!/перенес|перенос|дедлайн|отказ|погруз|инфо|замер/i.test(text)) return null;

      return {
        confidence: 0.96,
        reason: "Reply на карточку дедлайна входящей заявки",
      };
    },
  });
}

module.exports = { startAppealDeadlineWorker, runDeadlineCheck, registerDeadlineFastPath };
