// ============================================================================
// Расшифровка голосовых сообщений Telegram через Google STT (sync recognize).
//
// Только для коротких голосовых (до ~60 сек / ~10 MB inline).
// Использует уже существующий getSpeechClient() и ключ из env.
// Модель: latest_long — лучшая для русской разговорной речи до 1 мин.
// ============================================================================

const https = require("https");
const { hasCredentials, getSpeechClient } = require("../call-ai/googleAuth");

const LANGUAGE_CODE = "ru-RU";
const MODEL = "latest_long";
const MAX_VOICE_BYTES = 9 * 1024 * 1024; // 9 MB — inline лимит Google
const MAX_VOICE_SECONDS = 60;

function getTelegramFileUrl(filePath) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Telegram getFile HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * @param {object} voice — объект voice из Telegram (file_id, duration, file_size)
 * @param {object} bot — telegram bot instance для getFile
 * @returns {Promise<{ transcript: string|null, error: string|null }>}
 */
async function transcribeVoice(voice, bot) {
  if (!hasCredentials()) {
    return { transcript: null, error: "no_credentials" };
  }

  if (!bot) {
    return { transcript: null, error: "no_bot" };
  }

  const duration = voice.duration || 0;
  if (duration > MAX_VOICE_SECONDS) {
    console.log(`[voiceTranscribe] голосовое ${duration}s > ${MAX_VOICE_SECONDS}s — пропускаем`);
    return { transcript: null, error: "too_long" };
  }

  let filePath;
  try {
    const fileInfo = await bot.getFile(voice.file_id);
    filePath = fileInfo.file_path;
  } catch (err) {
    console.error("[voiceTranscribe] getFile упал:", err.message);
    return { transcript: null, error: "get_file_failed" };
  }

  let audioBuffer;
  try {
    const url = getTelegramFileUrl(filePath);
    audioBuffer = await downloadBuffer(url);
  } catch (err) {
    console.error("[voiceTranscribe] скачивание упало:", err.message);
    return { transcript: null, error: "download_failed" };
  }

  if (audioBuffer.length > MAX_VOICE_BYTES) {
    console.log(`[voiceTranscribe] файл ${audioBuffer.length} байт > лимит — пропускаем`);
    return { transcript: null, error: "too_large" };
  }

  const content = audioBuffer.toString("base64");

  const config = {
    encoding: "OGG_OPUS",
    sampleRateHertz: 48000,
    languageCode: LANGUAGE_CODE,
    model: MODEL,
    enableAutomaticPunctuation: true,
  };

  try {
    const speechApi = getSpeechClient();
    const res = await speechApi.speech.recognize({
      requestBody: {
        config,
        audio: { content },
      },
    });

    const results = res.data?.results || [];
    const transcript = results
      .map((r) => r.alternatives?.[0]?.transcript || "")
      .filter(Boolean)
      .join(" ")
      .trim();

    if (!transcript) {
      console.log("[voiceTranscribe] Google вернул пустой транскрипт");
      return { transcript: null, error: "empty_transcript" };
    }

    console.log(
      `[voiceTranscribe] OK: ${duration}s, ${audioBuffer.length} bytes, ` +
        `"${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}"`,
    );
    return { transcript, error: null };
  } catch (err) {
    console.error("[voiceTranscribe] Google STT упал:", err.message);
    return { transcript: null, error: "stt_failed" };
  }
}

const ERROR_LABELS = {
  too_long: "голосовое длиннее 1 минуты",
  too_large: "файл слишком большой",
  empty_transcript: "ничего не распознал",
  stt_failed: "ошибка распознавания",
  download_failed: "не удалось скачать файл",
  get_file_failed: "не удалось получить файл",
  no_credentials: "нет ключа Google STT",
  no_bot: "нет Telegram bot",
};

function labelTranscribeError(error) {
  return ERROR_LABELS[error] || "неизвестная ошибка";
}

module.exports = { transcribeVoice, labelTranscribeError };
