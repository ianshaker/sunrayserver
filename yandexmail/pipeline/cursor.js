// ============================================================================
// yandexmail/pipeline/cursor — закладка «докуда дочитали».
//
// Хранится в базе, если таблица заведена, и в памяти процесса, если ещё нет.
// Память — не про надёжность, а про то, чтобы работа не ждала миграции:
// после перезапуска без таблицы модуль возьмёт письма за последние два часа
// и дальше пойдёт по закладке.
//
// Почему не «письма за сегодня», как в ветке Gmail: там при простое дольше
// суток письма выпадают из окна поиска навсегда. Закладка от этого избавляет.
// ============================================================================

const { supabase } = require("../../lib/supabaseClient");

const TABLE = "yandex_imap_cursor";
const ROW_ID = "inbox";

/** Сколько истории берём, когда закладки ещё нет вовсе. */
const COLD_START_HOURS = 2;

/**
 * Коды ответа, которые значат «таблицы действительно нет»: `42P01` — ответ самого
 * Postgres, `PGRST205` — ответ PostgREST, когда он не нашёл таблицу в своей схеме.
 * Всё остальное — временная беда связи, и выключать из-за неё базу нельзя.
 */
const TABLE_ABSENT_CODES = new Set(["42P01", "PGRST205"]);

let memory = null; // { uidValidity, lastUid, updatedAt }
let tableMissing = false;

/**
 * Здоровье закладки — для сторожа тишины. Пока запись в базу проходит, откат после
 * перезапуска невозможен; как только перестала — счёт идёт до ближайшей выкладки.
 */
let health = { lastDbWriteAt: null, failuresInRow: 0, lastError: null };

function fromMemory() {
  return memory ? { ...memory, source: "память" } : null;
}

/**
 * Разбирает ошибку базы. Возвращает true, если таблицы нет и стучаться больше некуда.
 * 22.09.2026: раньше здесь любая ошибка выключала базу навсегда — и один обрыв связи
 * оставлял закладку только в памяти. После перезапуска робот брал из базы устаревший
 * номер и перечитывал письма заново: 18 сообщений «ПОВТОР» в чат за пять минут.
 */
function tablePropalaNavsegda(error) {
  return TABLE_ABSENT_CODES.has(String(error && error.code));
}

async function readCursor() {
  if (tableMissing) return fromMemory();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("uid_validity, last_uid, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      if (tablePropalaNavsegda(error)) {
        tableMissing = true;
        console.log(`[yandexmail/cursor] таблицы ${TABLE} нет (${error.message}) — закладка в памяти`);
      } else {
        // Связь моргнула. Этот проход идём от памяти, на следующем снова попробуем базу.
        console.log(`[yandexmail/cursor] чтение закладки не удалось (${error.message}) — на этот проход берём память`);
      }
      return fromMemory();
    }
    if (!data) return fromMemory();

    return {
      uidValidity: data.uid_validity ? String(data.uid_validity) : null,
      lastUid: Number(data.last_uid) || 0,
      updatedAt: data.updated_at,
      source: "база",
    };
  } catch (e) {
    // Сеть, таймаут, упавший клиент — что угодно, кроме «таблицы нет». База остаётся включённой.
    console.error("[yandexmail/cursor] чтение закладки:", e.message);
    return fromMemory();
  }
}

async function writeCursor({ uidValidity, lastUid }) {
  memory = { uidValidity, lastUid, updatedAt: new Date().toISOString() };
  if (tableMissing) return;

  const nePoluchilos = (prichina, error) => {
    health.failuresInRow += 1;
    health.lastError = prichina;
    if (tablePropalaNavsegda(error)) {
      tableMissing = true;
      console.log(`[yandexmail/cursor] таблицы ${TABLE} нет (${prichina}) — дальше закладка в памяти`);
      return;
    }
    // Проходы идут раз в минуту, и на следующем запись повторится сама. Память в этот
    // момент уже сдвинута, так что письма не перечитываются.
    console.log(
      `[yandexmail/cursor] запись закладки #${lastUid} не удалась (${prichina}), ` +
        `подряд неудач: ${health.failuresInRow} — повторим на следующем проходе`,
    );
  };

  try {
    const { error } = await supabase.from(TABLE).upsert({
      id: ROW_ID,
      uid_validity: uidValidity,
      last_uid: lastUid,
      updated_at: memory.updatedAt,
    });
    if (error) {
      nePoluchilos(error.message, error);
      return;
    }
    health.lastDbWriteAt = memory.updatedAt;
    health.failuresInRow = 0;
    health.lastError = null;
  } catch (e) {
    nePoluchilos(e.message, e);
  }
}

/**
 * Что со здоровьем закладки: когда она последний раз легла в базу и сколько попыток
 * подряд сорвалось. Нужно сторожу тишины: пока запись проходит, перезапуск сервера
 * безопасен, а как только перестала — следующая выкладка откатит робота назад.
 */
function getCursorHealth() {
  return {
    ...health,
    tableMissing,
    memoryUid: memory ? memory.lastUid : null,
  };
}

/**
 * С какого места читать в этот проход.
 *
 * В боевом режиме история не разбирается вовсе: без закладки чтение начинается
 * с текущего момента. Иначе первый же проход после перезапуска завёл бы заново
 * все заявки за последние часы — а заявку нельзя ни потерять, ни удвоить.
 *
 * @param {{uidValidity: string|null, uidNext: string|null}} mailboxState
 * @param {{live?: boolean}} options live — боевой режим, карточки заводятся
 * @returns {Promise<{mode: 'uid'|'recent'|'from_now', lastUid: number, hours: number, reason: string}>}
 */
async function planNextRead(mailboxState, { live = false } = {}) {
  const saved = await readCursor();
  const uidNow = Number(mailboxState.uidNext || 0) - 1;

  if (!saved || !saved.lastUid) {
    if (live) {
      return {
        mode: "from_now",
        lastUid: Math.max(uidNow, 0),
        hours: 0,
        reason: "боевой режим, закладки нет — начинаем с текущего момента, историю не разбираем",
      };
    }
    return { mode: "recent", lastUid: 0, hours: COLD_START_HOURS, reason: "закладки нет, холодный старт" };
  }

  if (saved.uidValidity && mailboxState.uidValidity && saved.uidValidity !== mailboxState.uidValidity) {
    if (live) {
      return {
        mode: "from_now",
        lastUid: Math.max(uidNow, 0),
        hours: 0,
        reason: `поколение ящика сменилось (${saved.uidValidity} → ${mailboxState.uidValidity}), боевой режим — начинаем заново с текущего момента`,
      };
    }
    return {
      mode: "recent",
      lastUid: 0,
      hours: 24,
      reason: `поколение ящика сменилось (${saved.uidValidity} → ${mailboxState.uidValidity}), пересверка за сутки`,
    };
  }

  return { mode: "uid", lastUid: saved.lastUid, hours: 0, reason: `идём от закладки #${saved.lastUid} (${saved.source})` };
}

module.exports = { TABLE, COLD_START_HOURS, writeCursor, planNextRead, getCursorHealth };
