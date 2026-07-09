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

function formatTimeRange(ev) {
  const st = ev.start_time ? String(ev.start_time).slice(0, 5) : "??:??";
  const et = ev.end_time ? String(ev.end_time).slice(0, 5) : "??:??";
  return `${st}–${et}`;
}

function buildMiniInfo(ev) {
  const parts = [];
  if (ev.client_name) parts.push(ev.client_name);
  if (ev.city) parts.push(ev.city);
  if (ev.appeal_number) parts.push(`заявка #${ev.appeal_number}`);
  return parts.join(", ");
}

function buildEventLine(ev) {
  const mini = buildMiniInfo(ev);
  const type = ev.type || "Событие";
  let line = `• #${ev.id} · ${formatTimeRange(ev)} · ${type}`;
  if (mini) line += ` — ${mini}`;
  return line;
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

  if (masterResult.assumed) {
    const altText = masterResult.alternatives.length
      ? ` (могли иметь в виду также: ${masterResult.alternatives.join(", ")})`
      : "";
    lines.push(
      `⚠️ УТОЧНЕНИЕ: «${masterResult.raw}» распознано как ${masterResult.canonical}${altText}. Если не так — напишите точнее.`,
    );
  }

  const headerScope =
    queryType === "time_point"
      ? `на ${formatDateHuman(date)}, ${timeFrom === timeTo ? timeFrom : `${timeFrom}–${timeTo}`}`
      : `на ${formatDateHuman(date)}`;
  lines.push(`📅 Расписание ${masterResult.canonical} ${headerScope}:`);

  if (!masterResult.events.length) {
    lines.push(`— нет событий.`);
    return lines.join("\n");
  }

  for (const ev of masterResult.events) {
    lines.push(buildEventLine(ev));
  }

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

module.exports = {
  renderScheduleAnswer,
  renderMasterBlock,
  buildFallbackVerdict,
  formatDateHuman,
  buildEventLine,
};
