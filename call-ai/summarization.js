// ============================================================================
// Саммари диалога звонка через Gemini (Vertex AI / Agent Platform).
//
// Вторая ступень после расшифровки: берёт готовый transcript и делает
// причёсанный пересказ от 3-го лица в поле summary.
// Авторизация — тот же сервис-аккаунт, что и для STT.
// ============================================================================

const { supabase } = require("./supabaseClient");
const { hasCredentials, getCredentials, getAuthClient } = require("./googleAuth");
const { SUMMARY } = require("./config");
const { CALL_SUMMARY_SYSTEM_PROMPT } = require("./prompts");
const { sendSummaryToTelegram, pollTelegramBacklog } = require("./telegramSummary");

const { POLL_MS, BATCH_LIMIT, STALE_MIN, VERTEX_LOCATION, MODEL: GEMINI_MODEL } = SUMMARY;

let isCycleRunning = false;

// Поля, нужные для саммари
const SELECT_FIELDS =
  "id, entry_id, direction, manager_name, client_phone, call_started_at, call_answered_at, transcript, transcript_status, summary, summary_status, summary_telegram_sent_at";

// Контекст конкретного звонка + расшифровка → user prompt.
function buildUserPrompt(row) {
  const dir =
    row.direction === 2
      ? "Исходящий звонок (менеджер звонил клиенту)"
      : "Входящий звонок (клиент звонил в компанию)";
  const lines = [
    dir,
    row.manager_name ? `Менеджер: ${row.manager_name}` : null,
    row.client_phone ? `Телефон клиента: ${row.client_phone}` : null,
    "",
    "Расшифровка разговора:",
    row.transcript || "",
  ].filter((l) => l !== null);
  return lines.join("\n");
}

// URL generateContent: regional (us-central1) или global (aiplatform.googleapis.com без префикса).
function buildGeminiUrl(projectId, location, model) {
  const path =
    `/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  if (location === "global") {
    return `https://aiplatform.googleapis.com${path}`;
  }
  return `https://${location}-aiplatform.googleapis.com${path}`;
}

// Gemini 2.5 Flash: thinking-токены считаются в maxOutputTokens → обрезанный текст.
// Для простого саммари thinking не нужен.
function looksIncompleteSummary(text, transcript) {
  const t = (text || "").trim();
  if (t.length < 80) return true;
  if (!/[.!?]$/.test(t)) return true;
  const src = transcript || "";
  const hasSizes = /\d{2,4}\s*[x×х]\s*\d{2,4}|\d{2,4}\s+\d{2,4}/i.test(src);
  const hasProduct = /штор|жалюз|рулон|римск|карниз/i.test(src);
  if (hasSizes && !/размер|\d{2,4}/i.test(t)) return true;
  if (hasProduct && !/штор|жалюз|рулон|карниз/i.test(t)) return true;
  if (src.length > 120 && !t.includes("Детали:")) return true;
  return false;
}

function extractSummaryText(resp) {
  const cand = resp.data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || "").join("").trim();
  const finishReason = cand?.finishReason || null;
  const usage = resp.data?.usageMetadata || {};
  return { text: text || "", finishReason, usage };
}

// Запрос к Gemini, возвращает текст саммари.
async function generateSummary(row) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;

  const url = buildGeminiUrl(projectId, VERTEX_LOCATION, GEMINI_MODEL);

  const body = {
    systemInstruction: { parts: [{ text: CALL_SUMMARY_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(row) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await client.request({ url, method: "POST", data: body, timeout: 60000 });
  const { text, finishReason, usage } = extractSummaryText(resp);

  if (finishReason === "MAX_TOKENS" || looksIncompleteSummary(text, row.transcript)) {
    console.warn(
      `⚠️ Саммари ${row.entry_id}: неполный ответ (finish=${finishReason}, ${text.length} симв., thoughts=${usage.thoughtsTokenCount || 0})`
    );
    return { text: "", finishReason, usage };
  }

  return { text, finishReason, usage };
}

// Саммари одной строки.
//
// Как и в transcription.js: все записи гейтятся direction=1, чтобы позднее
// пришедший summary (определивший звонок как исходящий) не мог быть перезаписан
// результатом, который был запущен, когда направление ещё не было известно.
async function summarizeRow(row) {
  const { id, entry_id } = row;

  await supabase
    .from("mango_calls")
    .update({ summary_status: "processing", summary_error: null })
    .eq("id", id)
    .eq("direction", 1);

  try {
    const { text, finishReason } = await generateSummary(row);

    if (!text) {
      await supabase
        .from("mango_calls")
        .update({
          summary_status: "failed",
          summary_error: finishReason === "MAX_TOKENS" ? "обрезано лимитом токенов" : "неполный или пустой ответ",
        })
        .eq("id", id)
        .eq("direction", 1);
      return;
    }

    const { data: updated } = await supabase
      .from("mango_calls")
      .update({
        summary: text || "",
        summary_status: text ? "done" : "skipped",
        summary_model: GEMINI_MODEL,
        summary_error: text ? null : "пустой ответ модели",
      })
      .eq("id", id)
      .eq("direction", 1)
      .select("id");

    if (!updated || updated.length === 0) {
      console.log(`⏭️ Саммари ${entry_id}: звонок оказался исходящим, результат отброшен (Telegram не шлём)`);
      return;
    }

    console.log(`📝 Саммари готово: ${entry_id} (${text.length} симв.)`);

    sendSummaryToTelegram({ ...row, summary: text, summary_status: "done" }).catch((e) =>
      console.error(`⚠️ Telegram после саммари ${entry_id}:`, e.message)
    );
  } catch (e) {
    const msg = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : String(e.message);
    console.error(`❌ Саммари ${entry_id}:`, msg);
    await supabase
      .from("mango_calls")
      .update({ summary_status: "failed", summary_error: msg.slice(0, 500) })
      .eq("id", id)
      .eq("direction", 1);
  }
}

// Fallback-поллинг очереди.
async function pollOnce() {
  if (isCycleRunning) return;
  isCycleRunning = true;

  try {
    const staleIso = new Date(Date.now() - STALE_MIN * 60 * 1000).toISOString();
    await supabase
      .from("mango_calls")
      .update({ summary_status: "pending" })
      .eq("summary_status", "processing")
      .lt("updated_at", staleIso);

    const { data, error } = await supabase
      .from("mango_calls")
      .select(SELECT_FIELDS)
      .eq("summary_status", "pending")
      .eq("transcript_status", "done")
      .eq("direction", 1)
      .not("transcript", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) {
      console.error("⚠️ Очередь саммари, ошибка выборки:", error.message);
      return;
    }
    if (!data || data.length === 0) return;

    for (const row of data) {
      if (!row.transcript || !row.transcript.trim()) {
        await supabase
          .from("mango_calls")
          .update({ summary_status: "skipped", summary_error: "пустая расшифровка" })
          .eq("id", row.id);
        continue;
      }
      await summarizeRow(row);
    }

    await pollTelegramBacklog();
  } catch (e) {
    console.error("⚠️ Цикл саммари упал:", e.message);
  } finally {
    isCycleRunning = false;
  }
}

// Мгновенный запуск саммари по entry_id (цепочка сразу после расшифровки).
async function triggerSummary(entryId) {
  if (!entryId) return { status: "no_entry_id" };
  if (!hasCredentials()) return { status: "disabled" };

  const { data, error } = await supabase
    .from("mango_calls")
    .select(SELECT_FIELDS)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (error) {
    console.error("⚠️ triggerSummary select error:", error.message);
    return { status: "error", message: error.message };
  }
  if (!data) return { status: "not_found" };
  // Исходящие звонки не саммаризируем — только храним аудио для истории.
  if (data.direction === 2) return { status: "skipped_outgoing" };
  if (data.transcript_status !== "done") return { status: "transcript_not_ready" };
  if (data.summary_status === "done") {
    sendSummaryToTelegram({ ...data, summary: data.summary }).catch(() => {});
    return { status: "already_done" };
  }
  if (data.summary_status === "processing") return { status: "already_processing" };
  if (data.summary_status === "skipped") return { status: "already_skipped" };

  if (!data.transcript || !data.transcript.trim()) {
    await supabase
      .from("mango_calls")
      .update({ summary_status: "skipped", summary_error: "пустая расшифровка" })
      .eq("id", data.id);
    return { status: "skipped_empty" };
  }

  await summarizeRow(data);
  return { status: "started", entry_id: entryId };
}

function startSummarizationWorker() {
  if (!hasCredentials()) {
    console.warn("⚠️ Саммари ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON в env");
    return;
  }
  console.log(
    `📝 Воркер саммари: цепочка после STT + fallback poll ${POLL_MS / 1000}с, модель=${GEMINI_MODEL}`
  );
  pollOnce().catch((e) => console.error("⚠️ summary pollOnce:", e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error("⚠️ summary pollOnce:", e.message));
  }, POLL_MS);
}

module.exports = { startSummarizationWorker, pollOnce, triggerSummary, summarizeRow };
