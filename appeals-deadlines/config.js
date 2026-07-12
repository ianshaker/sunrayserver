// ============================================================================
// Конфиг модуля «Дедлайны входящих».
// ============================================================================

/** Telegram-чат для уведомлений о дедлайнах. */
const DEADLINE_CHAT_ID = -1002585521272;

/** ID топика (thread) внутри группы. */
const DEADLINE_THREAD_ID = 3664;

/**
 * Часовой пояс для проверки рабочего окна и определения «сегодня».
 * Все reminder_date хранятся как дата без времени — сравниваем с MSK-датой.
 */
const MSK_OFFSET_HOURS = 3;

/** Рабочий час начала (включительно), MSK. */
const WORK_HOUR_START = 9;

/** Рабочий час конца (не включительно), MSK. */
const WORK_HOUR_END = 20;

/** true — круглосуточно (только для теста). false — рабочее окно 9–20 MSK. */
const DEADLINE_24_7 = false;

/** Cron-паттерн: каждые 30 минут (на 0-й секунде). */
const DEADLINE_CRON_PATTERN = "0 */30 * * * *";

/** Максимум символов диалога в карточке TG. */
const DIALOG_MAX_CHARS = 800;

/** Черновик превью (как в tasks/manage). */
const DRAFT_TTL_MS = 60 * 60 * 1000;

/** Префикс callback: ad:save:<draftId> / ad:cancel:<draftId> */
const CALLBACK_PREFIX = "ad";

/** Hard-cap карточек в ответе на «покажи все дедлайны». */
const QUERY_LIST_CAP = 10;

/**
 * Пауза между отдельными TG-сообщениями при пачке карточек (до QUERY_LIST_CAP).
 * ~2 msg/s — с запасом относительно лимитов Telegram на группу.
 */
const QUERY_SEND_GAP_MS = 450;

module.exports = {
  DEADLINE_CHAT_ID,
  DEADLINE_THREAD_ID,
  MSK_OFFSET_HOURS,
  WORK_HOUR_START,
  WORK_HOUR_END,
  DEADLINE_24_7,
  DEADLINE_CRON_PATTERN,
  DIALOG_MAX_CHARS,
  DRAFT_TTL_MS,
  CALLBACK_PREFIX,
  QUERY_LIST_CAP,
  QUERY_SEND_GAP_MS,
};
