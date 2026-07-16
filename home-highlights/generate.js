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
  const { data, error } = await supabase
    .from("home_daily_highlights")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`insert slot ${row.slot}: ${error.message}`);
  return data;
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
 * Актуальные ready/failed слоты за дату (+ опционально preview для админки).
 * Главная фильтрует status=ready отдельно; preview на главной не показывается.
 */
async function getLatestSlotsForDate(dateStr, { withPreviews = false } = {}) {
  const { data, error } = await supabase
    .from("home_daily_highlights")
    .select(
      "id, batch_id, highlight_date, slot, status, text, bot_comment, source_entry_id, model, created_at"
    )
    .eq("highlight_date", dateStr)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`чтение highlights: ${error.message}`);
  const rows = data || [];

  const publishedBySlot = new Map();
  const previewBySlot = new Map();

  for (const row of rows) {
    if (row.status === "preview") {
      if (withPreviews && !previewBySlot.has(row.slot)) previewBySlot.set(row.slot, row);
      continue;
    }
    if (!publishedBySlot.has(row.slot)) publishedBySlot.set(row.slot, row);
  }

  const latestRows = [...publishedBySlot.values()].sort((a, b) => a.slot - b.slot);

  if (withPreviews) {
    return {
      highlight_date: dateStr,
      batch_id: latestRows[0]?.batch_id || null,
      rows: latestRows.map((row) => ({
        ...row,
        preview: previewBySlot.get(row.slot) || null,
      })),
    };
  }

  return {
    highlight_date: dateStr,
    batch_id: latestRows[0]?.batch_id || null,
    rows: latestRows,
  };
}

async function getLatestBatchForDate(dateStr) {
  return getLatestSlotsForDate(dateStr);
}

async function getAdminSlotsForDate(dateStr) {
  return getLatestSlotsForDate(dateStr, { withPreviews: true });
}

async function deletePreviewsForSlot(dateStr, slot) {
  const { error } = await supabase
    .from("home_daily_highlights")
    .delete()
    .eq("highlight_date", dateStr)
    .eq("slot", slot)
    .eq("status", "preview");
  if (error) throw new Error(`очистка preview slot ${slot}: ${error.message}`);
}

/**
 * Перегенерация слота → сразу INSERT status=preview в БД.
 * На главной не видно, пока не confirmPreview.
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
    `[home-highlights] preview→DB date=${dateStr} slots=${slots.join(",")}`
  );

  try {
    const latest = await getLatestSlotsForDate(dateStr);
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

        await deletePreviewsForSlot(dateStr, slot);
        const batchId = crypto.randomUUID();
        const inserted = await insertHighlight({
          batch_id: batchId,
          highlight_date: dateStr,
          slot,
          type: "call_highlight",
          manager_name: null,
          source_entry_id: entryId,
          text: parsed.situation,
          bot_comment: parsed.bot_comment,
          model: GEMINI_MODEL,
          status: "preview",
        });

        previews.push({
          id: inserted.id,
          batch_id: batchId,
          slot,
          source_entry_id: entryId,
          text: parsed.situation,
          bot_comment: parsed.bot_comment,
          status: "preview",
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
 * Закрепить preview → ready (на главной станет актуальной).
 * Старая ready-строка остаётся в архиве.
 */
async function confirmPreview(previewId) {
  if (!previewId) {
    return { status: "error", message: "нужен id preview" };
  }

  const { data, error } = await supabase
    .from("home_daily_highlights")
    .update({ status: "ready" })
    .eq("id", previewId)
    .eq("status", "preview")
    .select("id, batch_id, highlight_date, slot, status, text, bot_comment")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { status: "error", message: "preview не найден или уже не черновик" };
  }

  console.log(
    `[home-highlights] confirm preview id=${previewId} slot=${data.slot} → ready`
  );
  // status: "ok" ПОСЛЕ ...data — иначе data.status ("ready") затирает ok → HTTP 400 на фронте
  return {
    ...data,
    status: "ok",
    highlight_status: data.status,
    slots: 1,
    replaced: [data.slot],
  };
}

/**
 * Удалить preview — остаётся прежняя ready-версия слота.
 */
async function discardPreview(previewId) {
  if (!previewId) {
    return { status: "error", message: "нужен id preview" };
  }

  const { data, error } = await supabase
    .from("home_daily_highlights")
    .delete()
    .eq("id", previewId)
    .eq("status", "preview")
    .select("id, slot, highlight_date")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    return { status: "error", message: "preview не найден" };
  }

  console.log(`[home-highlights] discard preview id=${previewId} slot=${data.slot}`);
  return { status: "ok", ...data };
}

/** Совместимость: commit по id preview → confirmPreview */
async function commitHighlightBatch(_dateStr, replacements) {
  const list = Array.isArray(replacements) ? replacements : [];
  const item = list[0];
  if (!item?.id) {
    return { status: "error", message: "нужен id preview-строки" };
  }
  return confirmPreview(item.id);
}

module.exports = {
  generateDailyHighlights,
  hasReadyHighlights,
  getLatestBatchForDate,
  getLatestSlotsForDate,
  getAdminSlotsForDate,
  previewHighlightSlots,
  commitHighlightBatch,
  confirmPreview,
  discardPreview,
  mskDateString,
  yesterdayMskDateString,
  mskDayRangeUtc,
  isValidDateStr,
};
