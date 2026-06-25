// ============================================================================
// Расшифровка записей разговоров через Google Speech-to-Text.
//
// Работает как фоновый воркер на Render (US): связь US → Google стабильна.
// Раз в POLL_MS секунд берёт из mango_calls звонки, у которых запись готова
// (recording_status='ready'), а расшифровки ещё нет (transcript_status='pending'),
// скачивает mp3 из Supabase Storage, шлёт в Google STT и пишет текст обратно.
//
// Авторизация Google — через уже установленный пакет `googleapis` (как Gmail),
// чтобы не тащить тяжёлый @google-cloud/speech и не рисковать версией Node.
// ============================================================================

const { google } = require("googleapis");
const { createClient } = require("@supabase/supabase-js");

// --- Supabase (тот же проект и ключ, что в mango.calls.new.js) ---
const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CALL_RECORDINGS_BUCKET = "call-recordings";

// --- Параметры расшифровки ---
const POLL_MS = 60000;            // fallback: если ping с Selectel не дошёл
const BATCH_LIMIT = 3;            // сколько записей за один цикл
const STALE_MIN = 15;            // через сколько минут "processing" считать зависшим
const OP_TIMEOUT_MS = 180000;     // макс. ожидание ответа Google на одну запись
const LANGUAGE_CODE = "ru-RU";
const STT_MODEL = process.env.GOOGLE_STT_MODEL || "latest_long";
const MODEL_LABEL = `google-stt-v1-${STT_MODEL}-${LANGUAGE_CODE}`;

let isCycleRunning = false;
let speechClient = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ленивая инициализация Google Speech-клиента из JSON сервис-аккаунта в env.
function getSpeechClient() {
  if (speechClient) return speechClient;

  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON не задан");

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON: невалидный JSON");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  speechClient = google.speech({ version: "v1", auth });
  return speechClient;
}

// Скачиваем mp3 из Supabase Storage → base64.
async function downloadAudioBase64(bucket, path) {
  const { data, error } = await supabase.storage
    .from(bucket || CALL_RECORDINGS_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error("Не удалось скачать mp3: " + (error?.message || "no data"));
  }

  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf).toString("base64");
}

// Запускаем длинное распознавание и ждём результат (поллинг операции).
async function recognize(audioBase64) {
  const speechApi = getSpeechClient();

  const requestBody = {
    config: {
      encoding: "MP3",
      sampleRateHertz: 8000,
      audioChannelCount: 1,
      languageCode: LANGUAGE_CODE,
      model: STT_MODEL,
      enableAutomaticPunctuation: true,
    },
    audio: { content: audioBase64 },
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
      const results = op.data.response?.results || [];
      return results
        .map((r) => r.alternatives?.[0]?.transcript || "")
        .join(" ")
        .trim();
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
    const audioBase64 = await downloadAudioBase64(storage_bucket, storage_path);
    const text = await recognize(audioBase64);

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

// Один цикл: вернуть зависшие в очередь и обработать пачку pending.
async function pollOnce() {
  if (isCycleRunning) return;
  isCycleRunning = true;

  try {
    // вернуть "залипшие" processing обратно в pending
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

// Мгновенный запуск расшифровки по entry_id (вызов с Selectel после сохранения mp3).
async function triggerTranscription(entryId) {
  if (!entryId) return { status: 'no_entry_id' };
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    return { status: 'disabled' };
  }

  const { data, error } = await supabase
    .from('mango_calls')
    .select('id, entry_id, storage_bucket, storage_path, transcript_status, recording_status')
    .eq('entry_id', entryId)
    .maybeSingle();

  if (error) {
    console.error('⚠️ triggerTranscription select error:', error.message);
    return { status: 'error', message: error.message };
  }
  if (!data) return { status: 'not_found' };
  if (data.recording_status !== 'ready' || !data.storage_path) {
    return { status: 'recording_not_ready' };
  }
  if (data.transcript_status === 'done') return { status: 'already_done' };
  if (data.transcript_status === 'processing') return { status: 'already_processing' };

  await transcribeRow(data);
  return { status: 'started', entry_id: entryId };
}

function startTranscriptionWorker() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    console.warn('⚠️ Расшифровка ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON в env');
    return;
  }
  console.log(
    `🎙️ Воркер расшифровки: push от Selectel + fallback poll ${POLL_MS / 1000}с, модель=${STT_MODEL}`
  );
  // fallback poll + подхват очереди при старте
  pollOnce().catch((e) => console.error('⚠️ pollOnce:', e.message));
  setInterval(() => {
    pollOnce().catch((e) => console.error('⚠️ pollOnce:', e.message));
  }, POLL_MS);
}

module.exports = { startTranscriptionWorker, pollOnce, triggerTranscription };
