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

let memory = null; // { uidValidity, lastUid, updatedAt }
let tableMissing = false;

function fromMemory() {
  return memory ? { ...memory, source: "память" } : null;
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
      // Таблицы ещё нет — работаем на памяти и больше в базу не стучимся.
      tableMissing = true;
      console.log(`[yandexmail/cursor] таблица ${TABLE} недоступна (${error.message}) — закладка в памяти`);
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
    tableMissing = true;
    console.error("[yandexmail/cursor] чтение закладки:", e.message);
    return fromMemory();
  }
}

async function writeCursor({ uidValidity, lastUid }) {
  memory = { uidValidity, lastUid, updatedAt: new Date().toISOString() };
  if (tableMissing) return;

  try {
    const { error } = await supabase.from(TABLE).upsert({
      id: ROW_ID,
      uid_validity: uidValidity,
      last_uid: lastUid,
      updated_at: memory.updatedAt,
    });
    if (error) {
      tableMissing = true;
      console.log(`[yandexmail/cursor] запись закладки не удалась (${error.message}) — дальше в памяти`);
    }
  } catch (e) {
    tableMissing = true;
    console.error("[yandexmail/cursor] запись закладки:", e.message);
  }
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

module.exports = { TABLE, COLD_START_HOURS, readCursor, writeCursor, planNextRead };
