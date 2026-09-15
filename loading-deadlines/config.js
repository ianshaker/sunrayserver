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

// Московское время — в lib/mskTime.js. eventsnew.deadline — календарный день,
// deadline_time — время по Москве.

/** Рабочий час начала (включительно), MSK. */
const WORK_HOUR_START = 9;

/** Рабочий час конца (не включительно), MSK. */
const WORK_HOUR_END = 20;

/** true — круглосуточно (режим теста). false — рабочее окно 9–20 MSK (как входящие). */
const DEADLINE_24_7 = false;

/** Cron-паттерн: каждые 30 минут (на 0-й секунде). */
const DEADLINE_CRON_PATTERN = "0 */30 * * * *";

/** Максимум символов диалога/заметки в карточке TG. */
const DIALOG_MAX_CHARS = 800;

/** Потолок карточек за раз: ответ «дай дедлайны», список «На сегодня» в сводке, кнопки сводки. */
const QUERY_LIST_CAP = 10;

/**
 * Пауза между отдельными TG-сообщениями при пачке карточек (до QUERY_LIST_CAP).
 * ~2 msg/s — с запасом относительно лимитов Telegram на группу.
 */
const QUERY_SEND_GAP_MS = 450;

/**
 * Сколько ⏰-пингов подряд по одной заявке до того, как она отложится до завтра
 * и уступит место следующей. 10 пингов ≈ полдня работы чата → 2 заявки в день.
 */
const PINGS_BEFORE_SNOOZE = 10;

/**
 * Свежий дедлайн (в днях назад): такие заявки показываются карточкой сразу,
 * не дожидаясь, пока разгребётся очередь висяков. Иначе замер с дедлайном на
 * сегодня встаёт 57-м в очередь и ждёт месяц.
 */
const FRESH_DEADLINE_DAYS = 7;

/** Утренняя сводка по дедлайнам: время по Москве (cron с секундами). */
const DIGEST_CRON_MSK = "0 0 9 * * *";

/** Сколько заявок без дедлайна перечислять в сводке (остальные — «и ещё N»). */
const DIGEST_PREVIEW_LIMIT = 5;

/** Одна и та же кнопка сводки — не чаще раза в это время (чтобы двое не завалили чат). */
const DIGEST_BUTTON_COOLDOWN_MS = 5 * 60 * 1000;

/** Черновик превью (между командой и «Сохранить»). */
const DRAFT_TTL_MS = 60 * 60 * 1000;

/**
 * Префикс кнопок модуля:
 *   ld:save|cancel:<черновик>   — превью команды,
 *   ldc:<действие>:<id события> — кнопки под карточкой,
 *   lds:<блок>                  — кнопки утренней сводки.
 */
const CALLBACK_PREFIX = "ld";

module.exports = {
  GEMINI_MODEL,
  VERTEX_LOCATION,
  LOADING_DEADLINE_CHAT_ID,
  WORK_HOUR_START,
  WORK_HOUR_END,
  DEADLINE_24_7,
  DEADLINE_CRON_PATTERN,
  DIALOG_MAX_CHARS,
  QUERY_LIST_CAP,
  QUERY_SEND_GAP_MS,
  PINGS_BEFORE_SNOOZE,
  FRESH_DEADLINE_DAYS,
  DIGEST_CRON_MSK,
  DIGEST_PREVIEW_LIMIT,
  DIGEST_BUTTON_COOLDOWN_MS,
  DRAFT_TTL_MS,
  CALLBACK_PREFIX,
};
