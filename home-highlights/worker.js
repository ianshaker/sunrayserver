// ============================================================================
// Cron + boot-фолбэк для home-highlights.
// ============================================================================

const schedule = require("node-schedule");
const { CRON_PATTERN, MODEL } = require("./config");
const { hasCredentials } = require("./gemini");
const {
  generateDailyHighlights,
  hasReadyHighlights,
  mskDateString,
  yesterdayMskDateString,
} = require("./generate");

let cronJob = null;

async function bootFallbackOnce() {
  try {
    const yesterday = yesterdayMskDateString();
    const exists = await hasReadyHighlights(yesterday);
    if (exists) {
      console.log(`[home-highlights] boot: за ${yesterday} уже есть ready — пропуск`);
      return;
    }
    console.log(`[home-highlights] boot: нет ready за ${yesterday} → генерация`);
    const result = await generateDailyHighlights(yesterday);
    console.log(`[home-highlights] boot → ${result.status}`);
  } catch (e) {
    console.error("[home-highlights] boot ошибка:", e.message);
  }
}

function startHomeHighlightsWorker() {
  if (!hasCredentials()) {
    console.warn("[home-highlights] ВЫКЛ: нет GOOGLE_APPLICATION_CREDENTIALS_JSON");
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
    console.log(`[home-highlights] cron сработал → ${yesterday}`);
    generateDailyHighlights(yesterday).catch((e) =>
      console.error("[home-highlights] cron ошибка:", e.message)
    );
  });

  console.log(
    `[home-highlights] cron=${CRON_PATTERN} (01:00 UTC = 04:00 MSK), model=${MODEL}`
  );
  console.log(
    `[home-highlights] сейчас МСК дата=${mskDateString()}, вчера=${yesterdayMskDateString()}`
  );

  setTimeout(() => {
    bootFallbackOnce().catch((e) =>
      console.error("[home-highlights] bootFallback:", e.message)
    );
  }, 15_000);
}

module.exports = { startHomeHighlightsWorker, bootFallbackOnce };
