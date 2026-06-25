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

const { POLL_MS, BATCH_LIMIT, STALE_MIN, VERTEX_LOCATION, MODEL: GEMINI_MODEL } = SUMMARY;

let isCycleRunning = false;

// Поля, нужные для саммари
const SELECT_FIELDS =
  "id, entry_id, direction, manager_name, client_phone, transcript, transcript_status, summary_status";

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

// Запрос к Gemini, возвращает текст саммари.
async function generateSummary(row) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;

  const url = buildGeminiUrl(projectId, VERTEX_LOCATION, GEMINI_MODEL);

  const body = {
    systemInstruction: { parts: [{ text: CALL_SUMMARY_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(row) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 700, topP: 0.9 },
  };

  const resp = await client.request({ url, method: "POST", data: body, timeout: 60000 });
  const cand = resp.data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || "").join("").trim();
  return text || "";
}

// Саммари одной строки.
async function summarizeRow(row) {
  const { id, entry_id } = row;

  await supabase
    .from("mango_calls")
    .update({ summary_status: "processing", summary_error: null })
    .eq("id", id);

  try {
    const text = await generateSummary(row);

    await supabase
      .from("mango_calls")
      .update({
        summary: text || "",
        summary_status: text ? "done" : "skipped",
        summary_model: GEMINI_MODEL,
        summary_error: text ? null : "пустой ответ модели",
      })
      .eq("id", id);

    console.log(`📝 Саммари готово: ${entry_id} (${text.length} симв.)`);
  } catch (e) {
    const msg = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : String(e.message);
    console.error(`❌ Саммари ${entry_id}:`, msg);
    await supabase
      .from("mango_calls")
      .update({ summary_status: "failed", summary_error: msg.slice(0, 500) })
      .eq("id", id);
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
  if (data.transcript_status !== "done") return { status: "transcript_not_ready" };
  if (data.summary_status === "done") return { status: "already_done" };
  if (data.summary_status === "processing") return { status: "already_processing" };

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
