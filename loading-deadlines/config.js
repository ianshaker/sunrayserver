// ============================================================================
// Конфиг модуля «Дедлайны погрузки».
// ============================================================================

// Только loading-deadlines. НЕ трогаем CALL_AI_* / DAILY_HIGHLIGHTS_* / другие отделы.
// Было через call-ai SUMMARY (= gemini-2.5-flash @ us-central1).
//   LOADING_DEADLINES_GEMINI_MODEL / LOADING_DEADLINES_VERTEX_LOCATION
const GEMINI_MODEL = process.env.LOADING_DEADLINES_GEMINI_MODEL || "gemini-2.5-flash";
const VERTEX_LOCATION = process.env.LOADING_DEADLINES_VERTEX_LOCATION || "us-central1";

/** Telegram-чат «Погрузка» / «НА ЗАМЕР» — карточки и пинги. */
const LOADING_DEADLINE_CHAT_ID = -1002669673493;

/**
 * Часовой пояс для проверки рабочего окна и «сейчас».
 * eventsnew.deadline — календарный день; deadline_time — MSK wall-clock.
 */
const MSK_OFFSET_HOURS = 3;

/** Рабочий час начала (включительно), MSK. */
const WORK_HOUR_START = 9;

/** Рабочий час конца (не включительно), MSK. */
const WORK_HOUR_END = 20;

/** true — круглосуточно (режим теста). false — рабочее окно 9–20 MSK. */
const DEADLINE_24_7 = true;

/** Cron-паттерн: каждые 30 минут (на 0-й секунде). */
const DEADLINE_CRON_PATTERN = "0 */30 * * * *";

/** Максимум символов диалога/заметки в карточке TG. */
const DIALOG_MAX_CHARS = 800;

/** Hard-cap карточек в ответе на «покажи все дедлайны по погрузке». */
const QUERY_LIST_CAP = 10;

/**
 * Пауза между отдельными TG-сообщениями при пачке карточек (до QUERY_LIST_CAP).
 * ~2 msg/s — с запасом относительно лимитов Telegram на группу.
 */
const QUERY_SEND_GAP_MS = 450;

/** Черновик превью (между командой и «Сохранить»). */
const DRAFT_TTL_MS = 60 * 60 * 1000;

/** Префикс callback: ld:save:<draftId> / ld:cancel:<draftId> */
const CALLBACK_PREFIX = "ld";

/** Ключ права в telegram_bot_chats.permissions. */
const PERMISSION = "loading_deadline";

module.exports = {
  GEMINI_MODEL,
  VERTEX_LOCATION,
  LOADING_DEADLINE_CHAT_ID,
  MSK_OFFSET_HOURS,
  WORK_HOUR_START,
  WORK_HOUR_END,
  DEADLINE_24_7,
  DEADLINE_CRON_PATTERN,
  DIALOG_MAX_CHARS,
  QUERY_LIST_CAP,
  QUERY_SEND_GAP_MS,
  DRAFT_TTL_MS,
  CALLBACK_PREFIX,
  PERMISSION,
};
