// ============================================================================
// Ежедневные «факты дня» для главной плитки CRM.
//
// Раз в сутки (04:00 МСК = 01:00 UTC): топ-5 самых длинных расшифровок
// входящих звонков за вчера → Gemini → 5 анонимизированных фраз в
// home_daily_highlights. CRM только читает таблицу.
// ============================================================================

const schedule = require("node-schedule");
const { supabase } = require("./supabaseClient");
const { hasCredentials, getCredentials, getAuthClient } = require("./googleAuth");
const { DAILY_HIGHLIGHTS } = require("./config");
const { DAILY_HIGHLIGHT_SYSTEM_PROMPT } = require("./prompts");

const {
  CRON_PATTERN,
  TOP_N,
  MAX_CHARS,
  SETUP_SECRET,
  VERTEX_LOCATION,
  MODEL: GEMINI_MODEL,
} = DAILY_HIGHLIGHTS;

let isGenerating = false;
let cronJob = null;

// --- даты по МСК (UTC+3) ---------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Календарная дата YYYY-MM-DD в часовом поясе МСК для момента `date`. */
function mskDateString(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${msk.getUTCFullYear()}-${pad2(msk.getUTCMonth() + 1)}-${pad2(msk.getUTCDate())}`;
}

/** Вчера по МСК (YYYY-MM-DD). */
function yesterdayMskDateString(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  msk.setUTCDate(msk.getUTCDate() - 1);
  return `${msk.getUTCFullYear()}-${pad2(msk.getUTCMonth() + 1)}-${pad2(msk.getUTCDate())}`;
}

/**
 * Диапазон суток highlight_date по МСК → ISO UTC границы [start, end).
 * МСК 00:00 = UTC предыдущего дня 21:00.
 */
function mskDayRangeUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // МСК midnight = UTC 21:00 предыдущего календарного дня
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// --- Gemini -----------------------------------------------------------------

function buildGeminiUrl(projectId, location, model) {
  const path =
    `/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  if (location === "global") {
    return `https://aiplatform.googleapis.com${path}`;
  }
  return `https://${location}-aiplatform.googleapis.com${path}`;
}

function extractText(resp) {
  const cand = resp.data?.candidates?.[0];
  return (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

function sanitizeHighlight(raw) {
  let t = (raw || "").trim();
  if (!t) return "";
  if (/^SKIP\b/i.test(t)) return "";
  // убрать обёртку кавычками, если модель решила так ответить
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("«") && t.endsWith("»"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (t.length > MAX_CHARS) {
    const cut = t.slice(0, MAX_CHARS);
    const lastSpace = cut.lastIndexOf(" ");
    t = (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim();
    if (!/[.!?…]$/.test(t)) t += "…";
  }
  return t;
}

async function generateHighlightFromTranscript(transcript) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;
  const url = buildGeminiUrl(projectId, VERTEX_LOCATION, GEMINI_MODEL);

  const body = {
    systemInstruction: { parts: [{ text: DAILY_HIGHLIGHT_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Расшифровка разговора:\n\n${transcript || ""}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 256,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await client.request({ url, method: "POST", data: body, timeout: 60000 });
  return sanitizeHighlight(extractText(resp));
}

// --- БД ---------------------------------------------------------------------

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
    console.error("[daily-highlights] проверка наличия:", error.message);
    return false;
  }
  return !!(data && data.length > 0);
}

// --- основная генерация -----------------------------------------------------

/**
 * Сгенерировать факты дня для календарной даты МСК `forDate` (YYYY-MM-DD).
 * По умолчанию — вчера по МСК.
 */
async function generateDailyHighlights(forDate) {
  const dateStr = forDate && isValidDateStr(forDate) ? forDate : yesterdayMskDateString();

  if (!hasCredentials()) {
    console.warn("[daily-highlights] ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON");
    return { status: "disabled", highlight_date: dateStr };
  }

  if (isGenerating) {
    return { status: "already_running", highlight_date: dateStr };
  }
  isGenerating = true;

  console.log(`[daily-highlights] старт генерации за ${dateStr}`);

  try {
    const calls = await fetchTopTranscripts(dateStr);
    if (calls.length === 0) {
      console.log(`[daily-highlights] нет подходящих расшифровок за ${dateStr}`);
      return { status: "no_calls", highlight_date: dateStr, generated: 0 };
    }

    let ready = 0;
    let failed = 0;
    const results = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const slot = i + 1;

      try {
        const text = await generateHighlightFromTranscript(call.transcript);
        if (!text) {
          await upsertHighlight({
            highlight_date: dateStr,
            slot,
            type: "call_highlight",
            manager_name: null,
            source_entry_id: call.entry_id,
            text: "SKIP",
            model: GEMINI_MODEL,
            status: "failed",
          });
          failed += 1;
          results.push({ slot, status: "skipped", entry_id: call.entry_id });
          console.log(`[daily-highlights] slot ${slot}: SKIP (${call.entry_id})`);
          continue;
        }

        await upsertHighlight({
          highlight_date: dateStr,
          slot,
          type: "call_highlight",
          manager_name: null,
          source_entry_id: call.entry_id,
          text,
          model: GEMINI_MODEL,
          status: "ready",
        });
        ready += 1;
        results.push({ slot, status: "ready", entry_id: call.entry_id, chars: text.length });
        console.log(`[daily-highlights] slot ${slot}: ready (${text.length} симв.)`);
      } catch (e) {
        const msg = e.response?.data
          ? JSON.stringify(e.response.data).slice(0, 400)
          : String(e.message);
        console.error(`[daily-highlights] slot ${slot} ошибка:`, msg);
        try {
          await upsertHighlight({
            highlight_date: dateStr,
            slot,
            type: "call_highlight",
            manager_name: null,
            source_entry_id: call.entry_id,
            text: msg.slice(0, 200) || "error",
            model: GEMINI_MODEL,
            status: "failed",
          });
        } catch (upsertErr) {
          console.error(`[daily-highlights] upsert failed slot:`, upsertErr.message);
        }
        failed += 1;
        results.push({ slot, status: "failed", entry_id: call.entry_id, error: msg.slice(0, 200) });
      }
    }

    console.log(`[daily-highlights] готово: ready=${ready} failed=${failed} date=${dateStr}`);
    return {
      status: "ok",
      highlight_date: dateStr,
      generated: ready,
      failed,
      total_calls: calls.length,
      results,
    };
  } catch (e) {
    console.error("[daily-highlights] цикл упал:", e.message);
    return { status: "error", highlight_date: dateStr, message: e.message };
  } finally {
    isGenerating = false;
  }
}

// --- cron + boot + HTTP -----------------------------------------------------

function checkSetupKey(key) {
  if (!SETUP_SECRET) return true;
  return typeof key === "string" && key.length > 0 && key === SETUP_SECRET;
}

async function bootFallbackOnce() {
  try {
    const yesterday = yesterdayMskDateString();
    const exists = await hasReadyHighlights(yesterday);
    if (exists) {
      console.log(`[daily-highlights] boot: за ${yesterday} уже есть ready — пропуск`);
      return;
    }
    console.log(`[daily-highlights] boot: нет ready за ${yesterday} → генерация`);
    const result = await generateDailyHighlights(yesterday);
    console.log(`[daily-highlights] boot → ${result.status}`);
  } catch (e) {
    console.error("[daily-highlights] boot ошибка:", e.message);
  }
}

function startDailyHighlightsWorker() {
  if (!hasCredentials()) {
    console.warn("[daily-highlights] ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON");
    return;
  }

  if (cronJob) {
    try {
      cronJob.cancel();
    } catch (_) {
      /* ignore */
    }
  }

  cronJob = schedule.scheduleJob(CRON_PATTERN, () => {
    const yesterday = yesterdayMskDateString();
    console.log(`[daily-highlights] cron сработал → ${yesterday}`);
    generateDailyHighlights(yesterday).catch((e) =>
      console.error("[daily-highlights] cron ошибка:", e.message)
    );
  });

  console.log(
    `[daily-highlights] cron=${CRON_PATTERN} (01:00 UTC = 04:00 MSK), model=${GEMINI_MODEL}`
  );
  console.log(`[daily-highlights] сейчас МСК дата=${mskDateString()}, вчера=${yesterdayMskDateString()}`);

  // Не ждём 4 утра: если вчерашних фактов нет — сгенерируем при старте.
  setTimeout(() => {
    bootFallbackOnce().catch((e) =>
      console.error("[daily-highlights] bootFallback:", e.message)
    );
  }, 15_000);
}

function registerDailyHighlightsRoute(fastify) {
  fastify.post("/api/daily-highlights/generate", async (request, reply) => {
    const key = request.query?.key || request.headers["x-setup-key"] || "";
    if (!checkSetupKey(key)) {
      return reply.code(403).send({ status: "error", error: "forbidden" });
    }

    const date = request.query?.date || request.body?.date || null;
    if (date && !isValidDateStr(date)) {
      return reply.code(400).send({ status: "error", error: "invalid_date", hint: "YYYY-MM-DD" });
    }

    const result = await generateDailyHighlights(date || undefined);
    const code = result.status === "error" ? 500 : result.status === "disabled" ? 503 : 200;
    return reply.code(code).send(result);
  });

  fastify.get("/api/daily-highlights/status", async (request, reply) => {
    const key = request.query?.key || "";
    if (!checkSetupKey(key)) {
      return reply.code(403).send({ status: "error", error: "forbidden" });
    }
    const yesterday = yesterdayMskDateString();
    const { data, error } = await supabase
      .from("home_daily_highlights")
      .select("highlight_date, slot, status, text, source_entry_id, created_at")
      .eq("highlight_date", yesterday)
      .order("slot", { ascending: true });

    if (error) {
      return reply.code(500).send({ status: "error", message: error.message });
    }
    return reply.send({
      status: "ok",
      highlight_date: yesterday,
      today_msk: mskDateString(),
      rows: data || [],
    });
  });
}

module.exports = {
  generateDailyHighlights,
  startDailyHighlightsWorker,
  registerDailyHighlightsRoute,
  yesterdayMskDateString,
  mskDateString,
  mskDayRangeUtc,
};
