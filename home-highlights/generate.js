// ============================================================================
// Генерация фактов дня → home_daily_highlights.
// Читает mango_calls только как источник расшифровок (SELECT), pipeline call-ai не трогает.
// ============================================================================

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

async function upsertHighlight(row) {
  const { error } = await supabase.from("home_daily_highlights").upsert(row, {
    onConflict: "highlight_date,slot",
  });
  if (error) throw new Error(`upsert slot ${row.slot}: ${error.message}`);
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

  console.log(`[home-highlights] старт генерации за ${dateStr}`);

  try {
    const calls = await fetchTopTranscripts(dateStr);
    if (calls.length === 0) {
      console.log(`[home-highlights] нет подходящих расшифровок за ${dateStr}`);
      return { status: "no_calls", highlight_date: dateStr, generated: 0 };
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
          await upsertHighlight({
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

        await upsertHighlight({
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
          await upsertHighlight({
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
        } catch (upsertErr) {
          console.error(
            `[home-highlights] upsert failed slot:`,
            upsertErr.message || JSON.stringify(upsertErr)
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

    console.log(`[home-highlights] готово: ready=${ready} failed=${failed} date=${dateStr}`);
    return {
      status: "ok",
      highlight_date: dateStr,
      generated: ready,
      failed,
      total_calls: calls.length,
      results,
    };
  } catch (e) {
    console.error("[home-highlights] цикл упал:", e.message);
    return { status: "error", highlight_date: dateStr, message: e.message };
  } finally {
    isGenerating = false;
  }
}

module.exports = {
  generateDailyHighlights,
  hasReadyHighlights,
  mskDateString,
  yesterdayMskDateString,
  mskDayRangeUtc,
  isValidDateStr,
};
