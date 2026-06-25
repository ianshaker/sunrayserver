// ============================================================================
// Расшифровка записей разговоров через Google Speech-to-Text.
//
// Работает на Render (US): связь US → Google стабильна.
// Берёт звонки, у которых запись готова (recording_status='ready'),
// а расшифровки ещё нет (transcript_status='pending'), скачивает mp3 из
// Supabase Storage, шлёт в Google STT и пишет текст обратно.
// ============================================================================

const { supabase } = require("./supabaseClient");
const { hasCredentials, getSpeechClient } = require("./googleAuth");
const { CALL_RECORDINGS_BUCKET, STT } = require("./config");
const { detectMp3SampleRate } = require("./mp3SampleRate");

const {
  POLL_MS,
  BATCH_LIMIT,
  STALE_MIN,
  OP_TIMEOUT_MS,
  LANGUAGE_CODE,
  MODEL: STT_MODEL,
  SAMPLE_RATE_HERTZ: STT_SAMPLE_RATE,
} = STT;
const MODEL_LABEL = `google-stt-v1-${STT_MODEL}-${LANGUAGE_CODE}`;

let isCycleRunning = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Скачиваем mp3 из Supabase Storage.
async function downloadAudio(bucket, path) {
  const { data, error } = await supabase.storage
    .from(bucket || CALL_RECORDINGS_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error("Не удалось скачать mp3: " + (error?.message || "no data"));
  }

  const arrayBuf = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  return buffer;
}

function buildRecognitionConfig(sampleRateHertz) {
  const config = {
    encoding: "MP3",
    audioChannelCount: 1,
    languageCode: LANGUAGE_CODE,
    model: STT_MODEL,
    enableAutomaticPunctuation: true,
  };
  if (sampleRateHertz) config.sampleRateHertz = sampleRateHertz;
  return config;
}

function collectTranscript(response) {
  const results = response?.results || [];
  const text = results
    .map((r) => r.alternatives?.[0]?.transcript || "")
    .filter(Boolean)
    .join(" ")
    .trim();
  const billed = response?.totalBilledTime || null;
  return { text, segments: results.length, billed };
}

// Длинное распознавание + поллинг операции.
async function recognize(audioBuffer) {
  const speechApi = getSpeechClient();

  const detectedRate = STT_SAMPLE_RATE || detectMp3SampleRate(audioBuffer) || 8000;
  const config = buildRecognitionConfig(detectedRate);

  const requestBody = {
    config,
    audio: { content: audioBuffer.toString("base64") },
  };

  const start = await speechApi.speech.longrunningrecognize({ requestBody });
  const opName = start.data.name;
  if (!opName) throw new Error("Google не вернул имя операции");

  const startedAt = Date.now();
  while (Date.now() - startedAt < OP_TIMEOUT_MS) {
    await sleep(3000);
    const op = await speechApi.operations.get({ name: opName });
    if (op.data.done) {
      if (op.data.error) {
        throw new Error("Google STT: " + (op.data.error.message || "operation error"));
      }
      const { text, segments, billed } = collectTranscript(op.data.response);
      console.log(
        `🎙️ STT: ${segments} сегм., billed=${billed || "?"}, rate=${detectedRate}Hz, model=${STT_MODEL}`
      );
      return text;
    }
  }

  throw new Error("Таймаут ожидания ответа Google STT");
}

// Расшифровываем одну строку звонка.
async function transcribeRow(row) {
  const { id, entry_id, storage_bucket, storage_path } = row;

  await supabase
    .from("mango_calls")
    .update({ transcript_status: "processing", transcript_error: null })
    .eq("id", id);

  try {
    const buffer = await downloadAudio(storage_bucket, storage_path);
    const text = await recognize(buffer);

    await supabase
      .from("mango_calls")
      .update({
        transcript: text || "",
        transcript_status: text ? "done" : "skipped",
        transcript_model: MODEL_LABEL,
        transcript_error: text ? null : "пустой результат распознавания",
      })
      .eq("id", id);

    console.log(`✅ Расшифровка готова: ${entry_id} (${text.length} симв.)`);

    // Вторая ступень: сразу причёсываем в саммари (ленивый require — без циклической зависимости).
    if (text) {
      try {
        const { triggerSummary } = require("./summarization");
        triggerSummary(entry_id).catch((e) => console.error("⚠️ triggerSummary:", e.message));
      } catch (e) {
        console.error("⚠️ summary chain:", e.message);
      }
    }
  } catch (e) {
    console.error(`❌ Расшифровка ${entry_id}:`, e.message);
    await supabase
      .from("mango_calls")
      .update({
        transcript_status: "failed",
        transcript_error: String(e.message).slice(0, 500),
      })
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
      .update({ transcript_status: "pending" })
      .eq("transcript_status", "processing")
      .lt("updated_at", staleIso);

    const { data, error } = await supabase
      .from("mango_calls")
      .select("id, entry_id, storage_bucket, storage_path")
      .eq("transcript_status", "pending")
      .eq("recording_status", "ready")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) {
      console.error("⚠️ Очередь расшифровки, ошибка выборки:", error.message);
      return;
    }
    if (!data || data.length === 0) return;

    for (const row of data) {
      await transcribeRow(row);
    }
  } catch (e) {
    console.error("⚠️ Цикл расшифровки упал:", e.message);
  } finally {
    isCycleRunning = false;
  }
}

// Мгновенный запуск расшифровки по entry_id (push с Selectel после сохранения mp3).
async function triggerTranscription(entryId) {
  if (!entryId) return { status: "no_entry_id" };
  if (!hasCredentials()) return { status: "disabled" };

  const { data, error } = await supabase
    .from("mango_calls")
    .select("id, entry_id, storage_bucket, storage_path, transcript_status, recording_status")
    .eq("entry_id", entryId)
    .maybeSingle();

  if (error) {
    console.error("⚠️ triggerTranscription select error:", error.message);
    return { status: "error", message: error.message };
  }
  if (!data) return { status: "not_found" };
  if (data.recording_status !== "ready" || !data.storage_path) {
    return { status: "recording_not_ready" };
  }
  if (data.transcript_status === "done") return { status: "already_done" };
  if (data.transcript_status === "processing") return { status: "already_processing" };

  await transcribeRow(data);
  return { status: "started", entry_id: entryId };
}

function startTranscriptionWorker() {
  if (!hasCredentials()) {
    console.warn("⚠️ Расшифровка ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON в env");
    return;
  }
  console.log(
    `🎙️ Воркер расшифровки: push от Selectel + fallback poll ${POLL_MS / 1000}с, модель=${STT_MODEL}`
  );
  pollOnce().catch((e) => console.error("⚠️ pollOnce:", e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error("⚠️ pollOnce:", e.message));
  }, POLL_MS);
}

module.exports = { startTranscriptionWorker, pollOnce, triggerTranscription, transcribeRow };
