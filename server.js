const path = require("path");
const fs = require("fs");
const fastify = require("fastify")({ logger: true });

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

// --- ИНТЕГРАЦИЯ TELEGRAM-БОТА (исходящие; входящие — через вебхук, без polling) --- //
const TelegramBot = require('node-telegram-bot-api');
const TELEGRAM_TOKEN = tgwebhookConfig.TELEGRAM_TOKEN;
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
setWebhookBot(telegramBot);
registerDiagnosticsHandlers();
registerTaskCallbackHandlers();

// --- Импорт обработчика манго (прокидываем telegramBot) --- //
const { handleMangoWebhook } = require("./mango.calls.new");

// --- Импорт новой функции для отправки замера --- //
const { registerZamerRoute } = require("./infonazamer");

// --- Импорт модуля push-уведомлений --- //
const { registerPushRoutes } = require("./pushmodul");

// --- Задачи менеджеров (CRM → Telegram) --- //
const { registerTaskRoute, startTaskReminderWorker, startDirectoryRefresh } = require("./tasks");

// --- Импорт функции для готовности --- //
const { registerReadinessRoute } = require("./readiness");

// --- Импорт функции для удаления дубликатов (только импорт, не запуск) --- //
const removeDuplicates = require("./remove_duplicates"); // пусть будет, даже если сейчас не вызывается

// --- Почта Gmail → заявки в CRM --- //
const { registerGmailAuthRoutes, startEmailChecker } = require("./postamails");

// --- Обработка звонков: расшифровка (Google STT) + саммари (Gemini) --- //
const { startCallAiWorkers, triggerTranscription, setTelegramBot, registerAskRoute } = require("./call-ai");
setTelegramBot(telegramBot);
startCallAiWorkers();

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
// Записи разговоров (/events/recording, /events/record/added) обрабатываются
// на mango-proxy (Selectel, RU): Render из US не может скачать файл у Mango.

// Selectel пингует сюда сразу после сохранения mp3 в Supabase → мгновенная расшифровка.
fastify.post("/internal/transcribe-ready", { preHandler: checkSelectelIP }, async (req, reply) => {
  const entryId = req.body?.entry_id;
  req.log.info({ entry_id: entryId }, "transcribe-ready от Selectel");
  const result = await triggerTranscription(entryId);
  return reply.send(result);
});

// --- Новый endpoint для назначения замера --- //
registerZamerRoute(fastify, telegramBot);

// И после registerZamerRoute добавьте:
registerTaskRoute(fastify, telegramBot);

// --- Регистрация маршрута готовности (добавить после других register) --- //
registerReadinessRoute(fastify, telegramBot);

// --- Подключаем push-маршруты (ВАЖНО: после объявления fastify, до listen!) --- //
registerPushRoutes(fastify);

// --- AI: вопрос по истории звонков клиента (CRM) --- //
registerAskRoute(fastify);

// --- Gmail OAuth (страница активации, без Telegram polling) --- //
registerGmailAuthRoutes(fastify);

// --- Telegram webhook: приём апдейтов + страница управления /telegram/setup --- //
registerTelegramWebhook(fastify);

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
    startTaskReminderWorker(telegramBot);
    startWebhookSelfHeal();
  }
);
