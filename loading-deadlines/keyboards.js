// ============================================================================
// Inline-кнопки модуля: превью команды, карточка дедлайна, утренняя сводка.
// ============================================================================

const { CALLBACK_PREFIX } = require("./config");

const CALLBACK_RE = new RegExp(`^${CALLBACK_PREFIX}:(save|cancel):([a-f0-9]+)$`);

function buildPreviewKeyboard(draftId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Сохранить", callback_data: `${CALLBACK_PREFIX}:save:${draftId}` },
        { text: "❌ Отменить", callback_data: `${CALLBACK_PREFIX}:cancel:${draftId}` },
      ],
    ],
  };
}

function parsePreviewCallback(data) {
  const match = String(data || "").match(CALLBACK_RE);
  if (!match) return null;
  return { action: match[1], draftId: match[2] };
}

// ============================================================================
// Кнопки под самой карточкой дедлайна (живут в чате месяцами).
//
// В callback_data лежит id события, а не ссылка на черновик: черновики живут в
// памяти процесса и умирают при каждой выкладке, а кнопка под карточкой должна
// работать и через месяц.
// ============================================================================

const CARD_PREFIX = `${CALLBACK_PREFIX}c`;
const CARD_RE = new RegExp(`^${CARD_PREFIX}:(d1|d3|d7|rej|rjy|rjn):(\\d+)$`);

/** Основной ряд кнопок карточки. */
function buildCardKeyboard(eventId) {
  return {
    inline_keyboard: [
      [
        { text: "Завтра", callback_data: `${CARD_PREFIX}:d1:${eventId}` },
        { text: "+3 дня", callback_data: `${CARD_PREFIX}:d3:${eventId}` },
        { text: "+7 дней", callback_data: `${CARD_PREFIX}:d7:${eventId}` },
        { text: "Отказ", callback_data: `${CARD_PREFIX}:rej:${eventId}` },
      ],
    ],
  };
}

/** Второй шаг отказа: он удаляет событие и заводит отказ — спрашиваем ещё раз. */
function buildRejectConfirmKeyboard(eventId) {
  return {
    inline_keyboard: [
      [
        { text: "Точно отказ", callback_data: `${CARD_PREFIX}:rjy:${eventId}` },
        { text: "Назад", callback_data: `${CARD_PREFIX}:rjn:${eventId}` },
      ],
    ],
  };
}

function parseCardCallback(data) {
  const match = String(data || "").match(CARD_RE);
  if (!match) return null;
  return { action: match[1], eventId: Number(match[2]) };
}

// ============================================================================
// Кнопки утренней сводки. В кнопке только имя блока — карточки собираются на
// момент нажатия, на сервере ничего не хранится.
// ============================================================================

const DIGEST_PREFIX = `${CALLBACK_PREFIX}s`;
const DIGEST_RE = new RegExp(`^${DIGEST_PREFIX}:(today|none|over)$`);

/** Кнопки только для непустых блоков сводки; все пусты — без клавиатуры. */
function buildDigestKeyboard({ today, none, over }) {
  const row = [];
  if (today) row.push({ text: "На сегодня", callback_data: `${DIGEST_PREFIX}:today` });
  if (none) row.push({ text: "Без дедлайна", callback_data: `${DIGEST_PREFIX}:none` });
  if (over) row.push({ text: "Просрочено", callback_data: `${DIGEST_PREFIX}:over` });
  return row.length ? { inline_keyboard: [row] } : undefined;
}

function parseDigestCallback(data) {
  const match = String(data || "").match(DIGEST_RE);
  return match ? { block: match[1] } : null;
}

module.exports = {
  buildPreviewKeyboard,
  parsePreviewCallback,
  buildCardKeyboard,
  buildRejectConfirmKeyboard,
  parseCardCallback,
  buildDigestKeyboard,
  parseDigestCallback,
};
