// ============================================================================
// Детерминированный рендер ответа — из реальных строк eventsnew, без LLM.
// Ассистент может добавить короткий комментарий сверху (commentary.js),
// но сам список слотов всегда строит этот файл.
// ============================================================================

function formatDateHuman(dateStr) {
  const date = new Date(`${dateStr}T00:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  const datePart = date.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const weekday = date.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
  });
  return `${datePart} (${weekday})`;
}

/** Компактная метка времени: 9, 10:15 */
function formatClockLabel(hhmm) {
  if (!hhmm) return "??";
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h)) return "??";
  if (!m) return String(h);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatEventTimeRange(ev) {
  return `${formatClockLabel(ev.start_time)}–${formatClockLabel(ev.end_time)}`;
}

const TYPE_EMOJI = {
  замер: "🟢",
  монтаж: "🔵",
  рекламация: "🔴",
};

function emojiForType(type) {
  const key = String(type || "").trim().toLowerCase();
  return TYPE_EMOJI[key] || "⚪";
}

function formatAppealNumber(num) {
  const s = String(num || "").trim();
  if (!s) return null;
  // В eventsnew.appeal_number уже хранится с «#» — не дублируем.
  return s.startsWith("#") ? s : `#${s}`;
}

// Формат строки события: смайлик типа + время + ID + город.
//   🟢 9–10:15 · #08198 — Можайск
// highlighted — для nearest_city: помечает строку, из-за которой мастер
// попал в подборку (👉), остальные события того же дня показываются как контекст.
function buildEventLine(ev, highlighted = false) {
  const emoji = emojiForType(ev.type);
  const appeal = formatAppealNumber(ev.appeal_number);
  const marker = highlighted ? "👉 " : "";
  let line = `${marker}${emoji} ${formatEventTimeRange(ev)}`;
  if (appeal) line += ` · ${appeal}`;
  if (ev.city) line += ` — ${ev.city}`;
  return line;
}

// Рабочий день мастера — 08:00–23:00 (см. договорённость по бизнесу).
const WORKDAY_START_MIN = 8 * 60;
const WORKDAY_END_MIN = 23 * 60;

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToHuman(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} мин`;
  if (!m) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/** Короткая метка часа для перерывов: 8, 9, 10:30 */
function minutesToGapLabel(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!m) return String(h);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function buildGapLine(fromMin, toMin) {
  const duration = toMin - fromMin;
  if (duration <= 0) return null;
  return `${minutesToGapLabel(fromMin)}-${minutesToGapLabel(toMin)} · пусто (${minutesToHuman(duration)})`;
}

/**
 * Список строк событий с промежутками свободного времени между ними,
 * в рамках рабочего дня 08:00–23:00. Считается кодом из тех же событий,
 * без LLM — просто разница между временем окончания одного события и
 * началом следующего (и от начала/до конца рабочего дня).
 * @param {object[]} events
 * @param {(ev: object) => boolean} [isHighlighted] — для nearest_city
 */
function buildEventLinesWithGaps(events, isHighlighted = () => false) {
  const lines = [];
  let cursor = WORKDAY_START_MIN;

  for (const ev of events) {
    const start = timeToMinutes(ev.start_time);
    if (start != null && start > cursor) {
      const gap = buildGapLine(cursor, start);
      if (gap) lines.push(gap);
    }
    lines.push(buildEventLine(ev, isHighlighted(ev)));
    const end = timeToMinutes(ev.end_time);
    if (end != null) cursor = Math.max(cursor, end);
    else if (start != null) cursor = Math.max(cursor, start);
  }

  if (cursor < WORKDAY_END_MIN) {
    const gap = buildGapLine(cursor, WORKDAY_END_MIN);
    if (gap) lines.push(gap);
  }

  return lines;
}

/**
 * @param {{
 *   canonical: string,
 *   assumed: boolean,
 *   alternatives: string[],
 *   raw: string,
 *   found: boolean,
 *   events: object[],
 * }} masterResult
 */
function renderMasterBlock(masterResult, date, queryType, timeFrom, timeTo) {
  const lines = [];

  if (!masterResult.found) {
    lines.push(`❓ Мастер «${masterResult.raw}» не найден в списке — уточните имя.`);
    return lines.join("\n");
  }

  if (masterResult.assumed && masterResult.alternatives.length) {
    lines.push(
      `⚠️ УТОЧНЕНИЕ: «${masterResult.raw}» распознано как ${masterResult.canonical} (могли иметь в виду также: ${masterResult.alternatives.join(", ")}). Если не так — напишите точнее.`,
    );
  } else if (masterResult.assumed) {
    // Уменьшительные/разговорные формы одного мастера (антоха, женя, дмитрий…)
    lines.push(
      `⚠️ УТОЧНЕНИЕ: «${masterResult.raw}» распознано как ${masterResult.canonical}. Если не так — напишите точнее.`,
    );
  }

  const headerScope =
    queryType === "time_point"
      ? `на ${formatDateHuman(date)}, ${timeFrom === timeTo ? timeFrom : `${timeFrom}–${timeTo}`}`
      : `на ${formatDateHuman(date)}`;
  lines.push(`📅 Расписание ${masterResult.canonical} ${headerScope}:`);

  if (!masterResult.events.length) {
    if (queryType === "full_day") {
      lines.push(`8-23 · пусто весь день`);
    } else {
      lines.push(`— нет событий.`);
    }
    return lines.join("\n");
  }

  // Промежутки свободного времени показываем только для полного дня —
  // при точечном запросе ("что в 13:00") события уже отфильтрованы под
  // конкретное время, и «дырки» рабочего дня туда добавлять не нужно.
  const eventLines =
    queryType === "full_day" ? buildEventLinesWithGaps(masterResult.events) : masterResult.events.map(buildEventLine);
  lines.push(...eventLines);

  return lines.join("\n");
}

/**
 * Детерминированный вердикт-заглушка (код, без LLM) — используется, когда
 * Gemini-комментарий выключен, недоступен или не прошёл проверку на
 * соответствие данным. Вердикт менеджер должен получать ВСЕГДА — либо от
 * модели (проверенный), либо этот, посчитанный напрямую из тех же строк.
 */
function buildFallbackVerdict(mastersResults, queryType, timeFrom, timeTo) {
  const found = mastersResults.filter((mr) => mr.found);
  if (!found.length) return null;

  // Именительный падеж («Леша:», не «у Леша») — код не умеет склонять имена,
  // конструкция «у + родительный» на канонических формах звучала бы неправильно.
  const parts = found.map((mr) => {
    const n = mr.events.length;
    if (queryType === "time_point") {
      const timeLabel = timeFrom === timeTo ? timeFrom : `${timeFrom}–${timeTo}`;
      if (!n) return `${mr.canonical} в ${timeLabel} — свободен`;
      const types = mr.events.map((ev) => ev.type || "событие").join(", ");
      return `${mr.canonical} в ${timeLabel} — занят (${types})`;
    }
    if (!n) return `${mr.canonical} — на эту дату событий нет`;
    return `${mr.canonical} — ${n} событи${n === 1 ? "е" : n < 5 ? "я" : "й"}`;
  });

  return `${parts.join("; ")}.`;
}

/** Собирает финальный ответ по всем запрошенным мастерам. */
function renderScheduleAnswer({ mastersResults, date, queryType, timeFrom, timeTo, commentary }) {
  const blocks = mastersResults.map((mr) => renderMasterBlock(mr, date, queryType, timeFrom, timeTo));
  const body = blocks.join("\n\n");
  const verdict = commentary || buildFallbackVerdict(mastersResults, queryType, timeFrom, timeTo);
  if (verdict) {
    return `${verdict}\n\n${body}`;
  }
  return body;
}

/**
 * Рендер одной группы (мастер, дата) для "nearest_city" — показывает ПОЛНЫЙ
 * день мастера (с промежутками, как в full_day), но помечает 👉 те строки,
 * из-за которых мастер попал в подборку (совпадение по искомому городу).
 * Если группа найдена не в самом искомом городе, а рядом (fallback по
 * расстоянию) — в заголовке честно указан реальный город и km до искомого.
 * @param {{ master: string, date: string, events: object[], matchKeys: Set<string>, matchedCity: string|null, distanceKm: number|null }} group
 */
function renderNearestCityGroup(group, buildRowMatchKey) {
  const lines = [];
  const nearbyNote =
    group.matchedCity && group.distanceKm != null
      ? ` · ${group.matchedCity} (~${Math.round(group.distanceKm)} км от искомого города)`
      : "";
  lines.push(`📍 ${group.master} — ${formatDateHuman(group.date)}${nearbyNote}:`);

  const isHighlighted = (ev) => group.matchKeys.has(buildRowMatchKey(ev));
  lines.push(...buildEventLinesWithGaps(group.events, isHighlighted));

  return lines.join("\n");
}

/** Детерминированный вердикт для "nearest_city" (без LLM — см. nearestCity.js). */
function buildNearestCityVerdict(groups, cityCanonical, typeFilterResolved, isNearbyFallback) {
  if (!groups.length) return null;
  const what = typeFilterResolved ? typeFilterResolved.toLowerCase() : "событие";
  const items = groups.map((g) => `${g.master} — ${formatDateHuman(g.date)}`);
  const n = groups.length;
  if (isNearbyFallback) {
    return (
      `В городе «${cityCanonical}» точных совпадений нет. Похожее рядом (${what}, до ${Math.round(
        Math.max(...groups.map((g) => g.distanceKm || 0)),
      )} км): ${items.join("; ")}.`
    );
  }
  return `Ближайш${n === 1 ? "ее совпадение" : "ие совпадения"} по городу «${cityCanonical}» (${what}): ${items.join("; ")}.`;
}

/**
 * Собирает финальный ответ для ветки "nearest_city".
 * @param {{
 *   status: "city_not_found"|"masters_not_found"|"no_matches"|"ok"|"ok_nearby",
 *   cityRaw?: string, mastersRaw?: string[],
 *   cityCanonical?: string, typeFilterResolved?: string|null, nearbyChecked?: boolean,
 *   masterWarnings?: object[], groups?: object[],
 * }} result
 */
function renderNearestCityAnswer(result, buildRowMatchKey) {
  if (result.status === "city_not_found") {
    return `❓ Город «${result.cityRaw}» не нашёл в списке — уточните название.`;
  }
  if (result.status === "masters_not_found") {
    const names = result.mastersRaw.map((m) => `«${m}»`).join(", ");
    return `❓ Не нашёл мастера ${names} в списке — уточните имя.`;
  }
  if (result.status === "no_matches") {
    const what = result.typeFilterResolved ? ` (${result.typeFilterResolved.toLowerCase()})` : "";
    const nearbyNote = result.nearbyChecked
      ? " Рядом (в пределах разумного расстояния) тоже пусто."
      : "";
    return `В обозримом будущем${what} в городе «${result.cityCanonical}» ничего не нашёл.${nearbyNote}`;
  }

  const lines = [];
  for (const w of result.masterWarnings || []) {
    lines.push(`⚠️ УТОЧНЕНИЕ: «${w.raw}» распознано как ${w.canonical}. Если не так — напишите точнее.`);
  }

  const isNearbyFallback = result.status === "ok_nearby";
  const verdict = buildNearestCityVerdict(result.groups, result.cityCanonical, result.typeFilterResolved, isNearbyFallback);
  if (verdict) lines.push(verdict);
  lines.push("");

  const blocks = result.groups.map((g) => renderNearestCityGroup(g, buildRowMatchKey));
  lines.push(blocks.join("\n\n"));

  return lines.join("\n");
}

module.exports = {
  renderScheduleAnswer,
  renderMasterBlock,
  renderNearestCityAnswer,
  buildFallbackVerdict,
  buildNearestCityVerdict,
  formatDateHuman,
  buildEventLine,
};
