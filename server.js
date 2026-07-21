const path = require("path");
const fs = require("fs");
const fastify = require("fastify")({
  logger: { level: process.env.FASTIFY_LOG_LEVEL || "warn" },
  // mp3 от Selectel на /internal/recording-upload (до ~50 МБ в Storage policy)
  bodyLimit: 55 * 1024 * 1024,
});

const { logSupabaseBoot } = require("./lib/supabaseClient");
logSupabaseBoot();

// --- Единый Telegram-вебхук (входящие апдейты: кнопки, команды, нейронки) --- //
const {
  registerTelegramWebhook,
  startWebhookSelfHeal,
  setTelegramBot: setWebhookBot,
  registerDiagnosticsHandlers,
  config: tgwebhookConfig,
} = require("./tgwebhook");
const { registerTaskCallbackHandlers } = require("./tasks/callbacks");
const { registerTaskCreateCallbacks } = require("./tasks/create/callbacks");
const { registerTaskManageCallbacks } = require("./tasks/manage/callbacks");
const { registerAppealDeadlineCallbacks } = require("./appeals-deadlines/callbacks");
const { startAppealDeadlineWorker, registerDeadlineFastPath } = require("./appeals-deadlines");
const { registerLoadingDeadlineCallbacks } = require("./loading-deadlines/callbacks");
const {
  startLoadingDeadlineWorker,
  registerLoadingDeadlineFastPath,
} = require("./loading-deadlines");
const { registerAssistant, startAssistant } = require("./assistant");
const { registerIntent } = require("./assistant/registry");
const { startBotChatsRefresh } = require("./lib/telegramBotChats");
const { registerBotChatsAdminRoutes } = require("./lib/telegramBotChatsAdmin");

// --- ИНТЕГРАЦИЯ TELEGRAM-БОТА (исходящие; входящие — через вебхук, без polling) --- //
const TelegramBot = require('node-telegram-bot-api');
const TELEGRAM_TOKEN = tgwebhookConfig.TELEGRAM_TOKEN;
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
setWebhookBot(telegramBot);
registerDiagnosticsHandlers();
registerTaskCallbackHandlers();
registerTaskCreateCallbacks();
registerTaskManageCallbacks();
registerAppealDeadlineCallbacks();
registerLoadingDeadlineCallbacks();
registerIntent(require("./tasks/create/intent"));
registerIntent(require("./tasks/manage/intent"));
registerIntent(require("./appeals-deadlines/intent"));
registerIntent(require("./appeals-deadlines/queryIntent"));
registerIntent(require("./loading-deadlines/intent"));
registerIntent(require("./loading-deadlines/queryIntent"));
registerIntent(require("./schedule-ai/intent"));
registerDeadlineFastPath();
registerLoadingDeadlineFastPath();
registerAssistant();

// --- Импорт обработчика манго (прокидываем telegramBot) --- //
const { handleMangoWebhook } = require("./mango.calls.new");

// --- Инфо на замер: TG по событиям (замер/монтаж/рекламация/погрузка) --- //
const { registerZamerRoute } = require("./info-na-zamer");

// --- Импорт модуля push-уведомлений --- //
const { registerPushRoutes } = require("./pushmodul");

// --- Задачи менеджеров (CRM → Telegram) --- //
const { registerTaskRoute, startTaskReminderWorker, startDirectoryRefresh } = require("./tasks");

// --- Импорт функции для готовности --- //
const { registerReadinessRoute } = require("./readiness");

// --- Скан договора → монтажный чат (PDF + caption) --- //
const { registerInstallationQueueRoute } = require("./installation-queue");

// --- JPEG графика мастера → личный TG-чат --- //
const { registerMasterScheduleRoute } = require("./master-schedule");

// --- Импорт функции для удаления дубликатов (только импорт, не запуск) --- //
const removeDuplicates = require("./remove_duplicates"); // пусть будет, даже если сейчас не вызывается

// --- Почта Gmail → заявки в CRM --- //
const { registerGmailAuthRoutes, startEmailChecker } = require("./postamails");

// --- Обработка звонков: расшифровка (Google STT) + саммари (Gemini) --- //
const {
  startCallAiWorkers,
  triggerTranscription,
  setTelegramBot,
  registerAskRoute,
  registerRecordingUploadRoute,
} = require("./call-ai");
const {
  startHomeHighlightsWorker,
  registerHomeHighlightsRoutes,
} = require("./home-highlights");

// --- Админ-чистка mango_calls (CRM Settings, без файла записи) --- //
const { registerMangoCallsRoutes } = require("./mango-calls");

setTelegramBot(telegramBot);
startCallAiWorkers();
startHomeHighlightsWorker();

// --- CORS, чтобы фронт мог делать запросы! --- //
fastify.register(require('@fastify/cors'), {
  origin: '*', // или укажи свой домен для безопасности
  methods: ['GET', 'POST', 'OPTIONS'],
});

// --- СТАТИКА И ФОРМЫ --- //
// Регистрируем статику только если папка существует
const publicPath = path.join(__dirname, "public");
if (fs.existsSync(publicPath)) {
  fastify.register(require("@fastify/static"), {
    root: publicPath,
    prefix: "/",
  });
} else {
  console.log("Папка 'public' не найдена, статические файлы не будут обслуживаться");
}
fastify.register(require("@fastify/formbody"));
fastify.register(require("@fastify/view"), {
  engine: { handlebars: require("handlebars") },
});

// --- Главная страница (для проверки сервера) --- //
fastify.get("/", async (request, reply) => {
  return { status: "ok", msg: "Hello from Fastify + Supabase!" };
});

// --- Проверка IP: только Selectel-прокси может слать вебхуки Манго --- //
const SELECTEL_IP = '135.106.155.17';

async function checkSelectelIP(req, reply) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress;

  const cleanIp = ip?.replace('::ffff:', '');

  if (cleanIp !== SELECTEL_IP) {
    req.log.warn(`Mango webhook rejected from IP: ${cleanIp}`);
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

// --- Маршруты для вебхуков Mango Office (только с Selectel) --- //
fastify.post("/events/call", { preHandler: checkSelectelIP }, (req, res) => handleMangoWebhook(req, res, telegramBot));
fastify.post("/events/summary", { preHandler: checkSelectelIP }, (req, res) => handleMangoWebhook(req, res, telegramBot));
// Записи: Selectel качает у Mango (геоблок) и шлёт mp3 сюда → Storage + STT.
registerRecordingUploadRoute(fastify, checkSelectelIP);

// Deprecated: пинг без файла (старый proxy). Оставлен на переход; предпочтителен recording-upload.
fastify.post("/internal/transcribe-ready", { preHandler: checkSelectelIP }, async (req, reply) => {
  const entryId = req.body?.entry_id;
  console.log(`[call-ai] transcribe-ready (legacy) entry=${entryId || "—"}`);
  const result = await triggerTranscription(entryId);
  console.log(`[call-ai] transcribe-ready → ${result.status}`);
  return reply.send(result);
});

// --- Инфо на замер: POST /events/zamer --- //
registerZamerRoute(fastify, telegramBot);

registerTaskRoute(fastify, telegramBot);

// --- Регистрация маршрута готовности (добавить после других register) --- //
registerReadinessRoute(fastify, telegramBot);

// --- Скан договора в монтажный чат: POST /events/installation-queue --- //
registerInstallationQueueRoute(fastify, telegramBot);

// --- График мастера (JPEG) в личный чат: POST /events/master-schedule --- //
registerMasterScheduleRoute(fastify);

// --- Подключаем push-маршруты (ВАЖНО: после объявления fastify, до listen!) --- //
registerPushRoutes(fastify);

// --- AI: вопрос по истории звонков клиента (CRM) --- //
registerAskRoute(fastify);

// --- Главная CRM: факты дня (отдельный отдел home-highlights, не call-ai) --- //
registerHomeHighlightsRoutes(fastify);

// --- CRM Settings: удаление строк mango_calls без файла записи --- //
registerMangoCallsRoutes(fastify);

// --- Gmail OAuth (страница активации, без Telegram polling) --- //
registerGmailAuthRoutes(fastify);

// --- Telegram webhook: приём апдейтов + страница управления /telegram/setup --- //
registerTelegramWebhook(fastify);
registerBotChatsAdminRoutes(fastify);

// --- Тестовый пинг --- //
fastify.get("/ping", async (req, reply) => {
  return { status: "pong" };
});

// --- Запуск сервера --- //
fastify.listen(
  { port: process.env.PORT || 3000, host: "0.0.0.0" },
  function (err, address) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`Your app is listening on ${address}`);
    startEmailChecker(telegramBot);
    startDirectoryRefresh();
    startBotChatsRefresh();
    startAssistant();
    startTaskReminderWorker(telegramBot);
    startAppealDeadlineWorker(telegramBot);
    startLoadingDeadlineWorker(telegramBot);
    startWebhookSelfHeal();
  }
);
