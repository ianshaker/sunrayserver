// ============================================================================
// Генерация фактов дня → home_daily_highlights.
// Читает mango_calls только как источник расшифровок (SELECT), pipeline call-ai не трогает.
//
// Каждая генерация — новый batch_id + INSERT (не upsert). Старые строки и
// home_daily_highlight_replies сохраняются; CRM показывает последний batch за дату.
// ============================================================================

const crypto = require("crypto");
const { supabase } = require("../lib/supabaseClient");
const { TOP_N, MODEL: GEMINI_MODEL } = require("./config");
const { hasCredentials, generateHighlightFromTranscript } = require("./gemini");

let isGenerating = false;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function mskDateString(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${msk.getUTCFullYear()}-${pad2(msk.getUTCMonth() + 1)}-${pad2(msk.getUTCDate())}`;
}

function yesterdayMskDateString(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  msk.setUTCDate(msk.getUTCDate() - 1);
  return `${msk.getUTCFullYear()}-${pad2(msk.getUTCMonth() + 1)}-${pad2(msk.getUTCDate())}`;
}

function mskDayRangeUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function fetchTopTranscripts(dateStr) {
  const { startIso, endIso } = mskDayRangeUtc(dateStr);

  const { data, error } = await supabase
    .from("mango_calls")
    .select("id, entry_id, manager_name, transcript, talk_seconds")
    .eq("direction", 1)
    .eq("transcript_status", "done")
    .not("transcript", "is", null)
    .gte("call_started_at", startIso)
    .lt("call_started_at", endIso)
    .order("talk_seconds", { ascending: false })
    .limit(TOP_N);

  if (error) throw new Error(`выборка звонков: ${error.message}`);
  return (data || []).filter((r) => r.transcript && r.transcript.trim().length > 40);
}

/** INSERT новой строки (новый id). Никогда не перезаписывает старый highlight. */
async function insertHighlight(row) {
  const { error } = await supabase.from("home_daily_highlights").insert(row);
  if (error) throw new Error(`insert slot ${row.slot}: ${error.message}`);
}

async function hasReadyHighlights(dateStr) {
  const { data, error } = await supabase
    .from("home_daily_highlights")
    .select("id")
    .eq("highlight_date", dateStr)
    .eq("status", "ready")
    .limit(1);
  if (error) {
    console.error("[home-highlights] проверка наличия:", error.message);
    return false;
  }
  return !!(data && data.length > 0);
}

/**
 * Сгенерировать факты дня для календарной даты МСК `forDate` (YYYY-MM-DD).
 * По умолчанию — вчера по МСК.
 * Всегда создаёт новый batch_id (архив предыдущих генераций не трогается).
 */
async function generateDailyHighlights(forDate) {
  const dateStr = forDate && isValidDateStr(forDate) ? forDate : yesterdayMskDateString();

  if (!hasCredentials()) {
    console.warn("[home-highlights] ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON");
    return { status: "disabled", highlight_date: dateStr };
  }

  if (isGenerating) {
    return { status: "already_running", highlight_date: dateStr };
  }
  isGenerating = true;

  const batchId = crypto.randomUUID();
  console.log(`[home-highlights] старт генерации за ${dateStr} batch=${batchId}`);

  try {
    const calls = await fetchTopTranscripts(dateStr);
    if (calls.length === 0) {
      console.log(`[home-highlights] нет подходящих расшифровок за ${dateStr}`);
      return { status: "no_calls", highlight_date: dateStr, batch_id: batchId, generated: 0 };
    }

    let ready = 0;
    let failed = 0;
    const results = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const slot = i + 1;

      try {
        const parsed = await generateHighlightFromTranscript(call.transcript);
        if (!parsed || !parsed.situation) {
          await insertHighlight({
            batch_id: batchId,
            highlight_date: dateStr,
            slot,
            type: "call_highlight",
            manager_name: null,
            source_entry_id: call.entry_id,
            text: "SKIP",
            bot_comment: null,
            model: GEMINI_MODEL,
            status: "failed",
          });
          failed += 1;
          results.push({ slot, status: "skipped", entry_id: call.entry_id });
          console.log(`[home-highlights] slot ${slot}: SKIP (${call.entry_id})`);
          continue;
        }

        await insertHighlight({
          batch_id: batchId,
          highlight_date: dateStr,
          slot,
          type: "call_highlight",
          manager_name: null,
          source_entry_id: call.entry_id,
          text: parsed.situation,
          bot_comment: parsed.bot_comment,
          model: GEMINI_MODEL,
          status: "ready",
        });
        ready += 1;
        results.push({
          slot,
          status: "ready",
          entry_id: call.entry_id,
          chars: parsed.situation.length,
          comment_chars: (parsed.bot_comment || "").length,
        });
        console.log(
          `[home-highlights] slot ${slot}: ready (${parsed.situation.length}+${(parsed.bot_comment || "").length} симв.)`
        );
      } catch (e) {
        const msg = e.response?.data
          ? JSON.stringify(e.response.data).slice(0, 400)
          : String(e.message || e);
        console.error(`[home-highlights] slot ${slot} ошибка:`, msg);
        try {
          await insertHighlight({
            batch_id: batchId,
            highlight_date: dateStr,
            slot,
            type: "call_highlight",
            manager_name: null,
            source_entry_id: call.entry_id,
            text: String(msg).slice(0, 200) || "error",
            bot_comment: null,
            model: GEMINI_MODEL,
            status: "failed",
          });
        } catch (insertErr) {
          console.error(
            `[home-highlights] insert failed slot:`,
            insertErr.message || JSON.stringify(insertErr)
          );
        }
        failed += 1;
        results.push({
          slot,
          status: "failed",
          entry_id: call.entry_id,
          error: String(msg).slice(0, 200),
        });
      }
    }

    console.log(
      `[home-highlights] готово: ready=${ready} failed=${failed} date=${dateStr} batch=${batchId}`
    );
    return {
      status: "ok",
      highlight_date: dateStr,
      batch_id: batchId,
      generated: ready,
      failed,
      total_calls: calls.length,
      results,
    };
  } catch (e) {
    console.error("[home-highlights] цикл упал:", e.message);
    return { status: "error", highlight_date: dateStr, batch_id: batchId, message: e.message };
  } finally {
    isGenerating = false;
  }
}

async function fetchCallByEntryId(entryId) {
  if (!entryId) return null;
  const { data, error } = await supabase
    .from("mango_calls")
    .select("entry_id, transcript, talk_seconds")
    .eq("entry_id", entryId)
    .maybeSingle();
  if (error) throw new Error(`звонок ${entryId}: ${error.message}`);
  return data || null;
}

/**
 * Последний batch за дату (все слоты), плюс meta.
 */
async function getLatestBatchForDate(dateStr) {
  const { data, error } = await supabase
    .from("home_daily_highlights")
    .select(
      "id, batch_id, highlight_date, slot, status, text, bot_comment, source_entry_id, model, created_at"
    )
    .eq("highlight_date", dateStr)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`чтение highlights: ${error.message}`);
  const rows = data || [];
  if (rows.length === 0) {
    return { highlight_date: dateStr, batch_id: null, rows: [] };
  }
  const batchId = rows[0].batch_id;
  const batchRows = rows
    .filter((r) => r.batch_id === batchId)
    .sort((a, b) => a.slot - b.slot);
  return { highlight_date: dateStr, batch_id: batchId, rows: batchRows };
}

/**
 * Превью перегенерации слотов БЕЗ записи в БД.
 * @param {string} dateStr
 * @param {number[]} slotNumbers 1..5
 */
async function previewHighlightSlots(dateStr, slotNumbers) {
  const slots = [...new Set((slotNumbers || []).map(Number))]
    .filter((s) => s >= 1 && s <= 5)
    .sort((a, b) => a - b);

  if (slots.length === 0) {
    return { status: "error", highlight_date: dateStr, message: "укажите slots: [1..5]" };
  }

  if (!hasCredentials()) {
    return { status: "disabled", highlight_date: dateStr };
  }
  if (isGenerating) {
    return { status: "already_running", highlight_date: dateStr };
  }

  isGenerating = true;
  console.log(
    `[home-highlights] preview date=${dateStr} slots=${slots.join(",")}`
  );

  try {
    const latest = await getLatestBatchForDate(dateStr);
    const bySlot = new Map(latest.rows.map((r) => [r.slot, r]));
    const topCalls = await fetchTopTranscripts(dateStr);
    const previews = [];

    for (const slot of slots) {
      const existing = bySlot.get(slot);
      let entryId = existing?.source_entry_id || null;
      let transcript = null;

      if (entryId) {
        const call = await fetchCallByEntryId(entryId);
        transcript = call?.transcript || null;
      }
      if ((!transcript || transcript.trim().length < 40) && topCalls[slot - 1]) {
        entryId = topCalls[slot - 1].entry_id;
        transcript = topCalls[slot - 1].transcript;
      }

      if (!transcript || transcript.trim().length < 40) {
        previews.push({
          slot,
          source_entry_id: entryId,
          text: null,
          bot_comment: null,
          status: "failed",
          model: GEMINI_MODEL,
          error: "no_transcript",
        });
        continue;
      }

      try {
        const parsed = await generateHighlightFromTranscript(transcript);
        if (!parsed || !parsed.situation) {
          previews.push({
            slot,
            source_entry_id: entryId,
            text: null,
            bot_comment: null,
            status: "failed",
            model: GEMINI_MODEL,
            error: "skip",
          });
          continue;
        }
        previews.push({
          slot,
          source_entry_id: entryId,
          text: parsed.situation,
          bot_comment: parsed.bot_comment,
          status: "ready",
          model: GEMINI_MODEL,
        });
      } catch (e) {
        previews.push({
          slot,
          source_entry_id: entryId,
          text: null,
          bot_comment: null,
          status: "failed",
          model: GEMINI_MODEL,
          error: String(e.message || e).slice(0, 200),
        });
      }
    }

    return { status: "ok", highlight_date: dateStr, previews };
  } catch (e) {
    console.error("[home-highlights] preview ошибка:", e.message);
    return { status: "error", highlight_date: dateStr, message: e.message };
  } finally {
    isGenerating = false;
  }
}

/**
 * Сохранить новый batch: replacements перекрывают слоты последнего batch,
 * остальные слоты копируются как были.
 * @param {string} dateStr
 * @param {Array<{slot, source_entry_id?, text, bot_comment?, status?}>} replacements
 */
async function commitHighlightBatch(dateStr, replacements) {
  const list = Array.isArray(replacements) ? replacements : [];
  if (list.length === 0) {
    return { status: "error", highlight_date: dateStr, message: "пустой replacements" };
  }

  const latest = await getLatestBatchForDate(dateStr);
  const bySlot = new Map();

  for (const row of latest.rows) {
    bySlot.set(row.slot, {
      slot: row.slot,
      source_entry_id: row.source_entry_id,
      text: row.text,
      bot_comment: row.bot_comment,
      status: row.status,
      model: row.model || GEMINI_MODEL,
    });
  }

  for (const item of list) {
    const slot = Number(item.slot);
    if (!(slot >= 1 && slot <= 5)) continue;
    const text = (item.text || "").trim();
    if (!text) continue;
    bySlot.set(slot, {
      slot,
      source_entry_id: item.source_entry_id || bySlot.get(slot)?.source_entry_id || null,
      text,
      bot_comment: item.bot_comment != null ? String(item.bot_comment) : null,
      status: item.status === "failed" ? "failed" : "ready",
      model: item.model || GEMINI_MODEL,
    });
  }

  if (bySlot.size === 0) {
    return { status: "error", highlight_date: dateStr, message: "нечего сохранять" };
  }

  const batchId = crypto.randomUUID();
  const slots = [...bySlot.keys()].sort((a, b) => a - b);

  for (const slot of slots) {
    const row = bySlot.get(slot);
    await insertHighlight({
      batch_id: batchId,
      highlight_date: dateStr,
      slot,
      type: "call_highlight",
      manager_name: null,
      source_entry_id: row.source_entry_id,
      text: row.text,
      bot_comment: row.bot_comment,
      model: row.model,
      status: row.status === "ready" ? "ready" : "failed",
    });
  }

  console.log(
    `[home-highlights] commit date=${dateStr} batch=${batchId} slots=${slots.join(",")}`
  );

  return {
    status: "ok",
    highlight_date: dateStr,
    batch_id: batchId,
    slots: slots.length,
    replaced: list.map((i) => Number(i.slot)).filter((s) => s >= 1 && s <= 5),
  };
}

module.exports = {
  generateDailyHighlights,
  hasReadyHighlights,
  getLatestBatchForDate,
  previewHighlightSlots,
  commitHighlightBatch,
  mskDateString,
  yesterdayMskDateString,
  mskDayRangeUtc,
  isValidDateStr,
};
