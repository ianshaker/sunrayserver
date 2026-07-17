// ============================================================================
// Расшифровка записей разговоров через Google Speech-to-Text.
//
// Работает на Render (US): связь US → Google стабильна.
// Основной путь: Selectel отдаёт mp3 на /internal/recording-upload → Buffer → STT.
// CRM request-ai / safety-sweep: скачивание из Supabase Storage.
// ============================================================================

const { supabase } = require("./supabaseClient");
const { hasCredentials, getSpeechClient } = require("./googleAuth");
const { CALL_RECORDINGS_BUCKET, STT } = require("./config");
const { detectMp3SampleRate } = require("./mp3SampleRate");
const { getBucketName, ensureBucket, uploadObject, deleteObject } = require("./gcsStorage");

/** Summary уже дописал строку — иначе default direction=1 на заготовке = ложный STT исходящих. */
function hasSummaryMeta(row) {
  if (!row) return false;
  if (row.call_started_at) return true;
  if (row.client_phone_digits && String(row.client_phone_digits).trim()) return true;
  return false;
}

const {
  POLL_MS,
  BATCH_LIMIT,
  STALE_MIN,
  OP_TIMEOUT_MS,
  LANGUAGE_CODE,
  MODEL: STT_MODEL,
  SAMPLE_RATE_HERTZ: STT_SAMPLE_RATE,
  SYNC_MAX_SECONDS,
  LONGRUNNING_POLL_MS,
} = STT;
const MODEL_LABEL = `google-stt-v1-${STT_MODEL}-${LANGUAGE_CODE}`;

let isCycleRunning = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadAudio(bucket, path) {
  const { data, error } = await supabase.storage
    .from(bucket || CALL_RECORDINGS_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error("Не удалось скачать mp3: " + (error?.message || "no data"));
  }

  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
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

/**
 * Sync Google: лимит 60 с / 10 MB.
 * talk_seconds из БД предпочтителен; иначе грубая оценка по размеру (8 kHz mono mp3 ≈ 1 КБ/с).
 */
function shouldUseSyncRecognize(audioBuffer, talkSeconds) {
  const maxSec = SYNC_MAX_SECONDS || 60;
  const t = talkSeconds != null ? Number(talkSeconds) : NaN;
  if (Number.isFinite(t) && t > 0) {
    return t < maxSec;
  }
  const bytes = audioBuffer?.length || 0;
  if (bytes <= 0) return true;
  if (bytes > 9 * 1024 * 1024) return false;
  // 8 kHz mono mp3 телефонии ≈ 1 КБ/с — грубая оценка без talk_seconds
  return bytes / 1000 < maxSec;
}

async function pollOperation(speechApi, opName, detectedRate) {
  const pollMs = LONGRUNNING_POLL_MS || 5000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < OP_TIMEOUT_MS) {
    await sleep(pollMs);
    const op = await speechApi.operations.get({ name: opName });
    if (op.data.done) {
      if (op.data.error) {
        throw new Error("Google STT: " + (op.data.error.message || "operation error"));
      }
      const { text, segments, billed } = collectTranscript(op.data.response);
      console.log(
        `🎙️ STT longrunning: ${segments} сегм., billed=${billed || "?"}, rate=${detectedRate}Hz, model=${STT_MODEL}`,
      );
      return text;
    }
  }
  throw new Error("Таймаут ожидания ответа Google STT");
}

async function recognizeSync(audioBuffer, detectedRate, config) {
  const speechApi = getSpeechClient();
  const res = await speechApi.speech.recognize({
    requestBody: {
      config,
      audio: { content: audioBuffer.toString("base64") },
    },
  });
  const { text, segments, billed } = collectTranscript(res.data);
  console.log(
    `🎙️ STT sync: ${segments} сегм., billed=${billed || "?"}, rate=${detectedRate}Hz, model=${STT_MODEL}`,
  );
  return text;
}

async function recognizeLongrunning(audioBuffer, objectName, detectedRate, config) {
  const speechApi = getSpeechClient();
  const bucket = getBucketName();
  await ensureBucket(bucket);
  const gcsUri = await uploadObject(bucket, objectName, audioBuffer, "audio/mpeg");

  try {
    const start = await speechApi.speech.longrunningrecognize({
      requestBody: { config, audio: { uri: gcsUri } },
    });
    const opName = start.data.name;
    if (!opName) throw new Error("Google не вернул имя операции");
    return await pollOperation(speechApi, opName, detectedRate);
  } finally {
    await deleteObject(bucket, objectName);
  }
}

/**
 * @param {Buffer} audioBuffer
 * @param {string} objectName — имя объекта GCS (только для longrunning)
 * @param {{ talkSeconds?: number|null }} [opts]
 */
async function recognize(audioBuffer, objectName, opts = {}) {
  const detectedRate = STT_SAMPLE_RATE || detectMp3SampleRate(audioBuffer) || 8000;
  const config = buildRecognitionConfig(detectedRate);
  const useSync = shouldUseSyncRecognize(audioBuffer, opts.talkSeconds);

  if (useSync) {
    console.log(
      `🎙️ STT путь=sync (talk_seconds=${opts.talkSeconds ?? "?"}, bytes=${audioBuffer.length})`,
    );
    return recognizeSync(audioBuffer, detectedRate, config);
  }

  console.log(
    `🎙️ STT путь=gcs+longrunning (talk_seconds=${opts.talkSeconds ?? "?"}, bytes=${audioBuffer.length})`,
  );
  return recognizeLongrunning(audioBuffer, objectName, detectedRate, config);
}

/**
 * @param {object} row
 * @param {{ force?: boolean, audioBuffer?: Buffer }} [opts]
 */
async function transcribeRow(row, opts = {}) {
  const force = Boolean(opts.force);
  const { id, entry_id, storage_bucket, storage_path, talk_seconds } = row;

  let processingQ = supabase
    .from("mango_calls")
    .update({ transcript_status: "processing", transcript_error: null })
    .eq("id", id);
  if (!force) processingQ = processingQ.eq("direction", 1);
  await processingQ;

  try {
    const buffer =
      opts.audioBuffer && Buffer.isBuffer(opts.audioBuffer)
        ? opts.audioBuffer
        : await downloadAudio(storage_bucket, storage_path);
    const objectName = `stt/${String(entry_id).replace(/[^A-Za-z0-9._-]/g, "_")}-${Date.now()}.mp3`;
    const text = await recognize(buffer, objectName, { talkSeconds: talk_seconds });

    let doneQ = supabase
      .from("mango_calls")
      .update({
        transcript: text || "",
        transcript_status: text ? "done" : "skipped",
        transcript_model: MODEL_LABEL,
        transcript_error: text ? null : "пустой результат распознавания",
      })
      .eq("id", id);
    if (!force) doneQ = doneQ.eq("direction", 1);
    const { data: updated } = await doneQ.select("id");

    if (!updated || updated.length === 0) {
      console.log(`⏭️ Расшифровка ${entry_id}: звонок оказался исходящим, результат отброшен`);
      return;
    }

    console.log(`✅ Расшифровка готова: ${entry_id} (${text.length} симв.)${force ? " [force]" : ""}`);

    if (text) {
      try {
        const { triggerSummary } = require("./summarization");
        triggerSummary(entry_id, { force }).catch((e) =>
          console.error("⚠️ triggerSummary:", e.message),
        );
      } catch (e) {
        console.error("⚠️ summary chain:", e.message);
      }
    }
  } catch (e) {
    console.error(`❌ Расшифровка ${entry_id}:`, e.message);
    let failQ = supabase
      .from("mango_calls")
      .update({
        transcript_status: "failed",
        transcript_error: String(e.message).slice(0, 500),
      })
      .eq("id", id);
    if (!force) failQ = failQ.eq("direction", 1);
    await failQ;
  }
}

/** Safety-sweep: редко. Основной старт — recording-upload / CRM request-ai. */
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
      .select(
        "id, entry_id, storage_bucket, storage_path, talk_seconds, call_started_at, client_phone_digits",
      )
      .eq("transcript_status", "pending")
      .eq("recording_status", "ready")
      .eq("direction", 1)
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);

    if (error) {
      console.error("⚠️ Очередь расшифровки, ошибка выборки:", error.message);
      return;
    }
    if (!data || data.length === 0) return;

    // Файл раньше summary: заготовка с direction=1 — не трогаем до meta.
    const ready = data.filter(hasSummaryMeta);
    if (ready.length === 0) return;

    console.log(`🛟 Safety-sweep STT: ${ready.length} шт.`);
    for (const row of ready) {
      await transcribeRow(row);
    }
  } catch (e) {
    console.error("⚠️ Цикл расшифровки упал:", e.message);
  } finally {
    isCycleRunning = false;
  }
}

/**
 * @param {string} entryId
 * @param {{ force?: boolean, audioBuffer?: Buffer }} [opts]
 */
async function triggerTranscription(entryId, opts = {}) {
  const force = Boolean(opts.force);
  if (!entryId) return { status: "no_entry_id" };
  if (!hasCredentials()) return { status: "disabled" };

  const { data, error } = await supabase
    .from("mango_calls")
    .select(
      "id, entry_id, storage_bucket, storage_path, transcript_status, recording_status, direction, talk_seconds",
    )
    .eq("entry_id", entryId)
    .maybeSingle();

  if (error) {
    console.error("⚠️ triggerTranscription select error:", error.message);
    return { status: "error", message: error.message };
  }
  if (!data) return { status: "not_found" };
  if (!force && data.direction === 2) return { status: "skipped_outgoing" };
  if (data.recording_status !== "ready" || !data.storage_path) {
    return { status: "recording_not_ready" };
  }
  if (!force) {
    if (data.transcript_status === "done") return { status: "already_done" };
    if (data.transcript_status === "processing") return { status: "already_processing" };
    if (data.transcript_status === "skipped") return { status: "already_skipped" };
  } else {
    if (data.transcript_status === "processing") return { status: "already_processing" };
  }

  await transcribeRow(data, { force, audioBuffer: opts.audioBuffer });
  return { status: "started", entry_id: entryId };
}

function startTranscriptionWorker() {
  if (!hasCredentials()) {
    console.warn("⚠️ Расшифровка ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON в env");
    return;
  }
  console.log(
    `🎙️ Воркер расшифровки: push recording-upload + safety-sweep ${POLL_MS / 1000}с, sync<${SYNC_MAX_SECONDS || 60}с, модель=${STT_MODEL}`,
  );
  // Первый проход не сразу при старте — дать подняться сервису; далее редко.
  setTimeout(() => {
    pollOnce().catch((e) => console.error("⚠️ pollOnce:", e.message));
  }, 30000);
  setInterval(() => {
    pollOnce().catch((e) => console.error("⚠️ pollOnce:", e.message));
  }, POLL_MS);
}

module.exports = {
  startTranscriptionWorker,
  pollOnce,
  triggerTranscription,
  transcribeRow,
  recognize,
  shouldUseSyncRecognize,
};
