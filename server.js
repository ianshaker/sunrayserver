const path = require("path");
const fs = require("fs");
const fastify = require("fastify")({ logger: true });

// --- ИНТЕГРАЦИЯ TELEGRAM-БОТА --- //
const TelegramBot = require('node-telegram-bot-api');
const TELEGRAM_TOKEN = '7866133715:AAH2lSoDsDnmpQhEjSghjNb23ezp98IZW4g';

// Создаем бота с обработкой ошибок polling
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { 
  polling: {
    interval: 1000, // интервал опроса в мс
    autoStart: false // не запускаем автоматически
  }
});

// Обработка ошибок polling
telegramBot.on('polling_error', (error) => {
  const errorMessage = error.message || String(error);
  console.error('❌ Ошибка polling Telegram бота:', errorMessage);
  
  // Проверяем разные варианты ошибки 409 (конфликт polling)
  const isConflictError = 
    errorMessage.includes('409') || 
    errorMessage.includes('Conflict') || 
    errorMessage.includes('terminated by other getUpdates') ||
    (error.code === 'ETELEGRAM' && errorMessage.includes('409'));
  
  if (isConflictError) {
    console.warn('⚠️ ВНИМАНИЕ: Другой экземпляр бота уже использует polling (ошибка 409).');
    console.warn('⚠️ Останавливаем polling на этом сервере. Бот будет работать только для отправки сообщений.');
    console.warn('⚠️ Команды /gmail_code не будут обрабатываться на этом сервере.');
    // Останавливаем polling, но не падаем - бот продолжит работать для отправки сообщений
    telegramBot.stopPolling().catch(() => {});
  } else {
    // Для других ошибок - логируем и пытаемся продолжить работу
    console.log('⚠️ Ошибка polling (не критичная), продолжаем работу...');
  }
});

// Запускаем polling с обработкой ошибок
telegramBot.startPolling().catch((error) => {
  const errorMessage = error.message || String(error);
  const isConflictError = 
    errorMessage.includes('409') || 
    errorMessage.includes('Conflict') || 
    errorMessage.includes('terminated by other getUpdates');
  
  if (isConflictError) {
    console.warn('⚠️ Polling уже используется другим экземпляром бота (ошибка 409).');
    console.warn('⚠️ Бот будет работать только для отправки сообщений. Команды /gmail_code не будут обрабатываться.');
  } else {
    console.error('❌ Не удалось запустить polling:', errorMessage);
    console.log('⚠️ Бот будет работать только для отправки сообщений.');
  }
});

// --- Импорт обработчика манго (прокидываем telegramBot) --- //
const { handleMangoWebhook } = require("./mango.calls.new");

// --- Импорт новой функции для отправки замера --- //
const { registerZamerRoute } = require("./infonazamer");

// --- Импорт модуля push-уведомлений --- //
const { registerPushRoutes } = require("./pushmodul");

// --- Импорт функции для обновления contractsfinalnew.json --- //
const { registerContractsUpdateRoute } = require("./contractsfinalupd");
registerContractsUpdateRoute(fastify);

// --- Импорт новой функции для задач --- //
const { registerTaskRoute } = require("./infozadachi");

// --- Импорт функции для готовности --- //
const { registerReadinessRoute } = require("./readiness");

// --- Импорт функции для удаления дубликатов (только импорт, не запуск) --- //
const removeDuplicates = require("./remove_duplicates"); // пусть будет, даже если сейчас не вызывается

// --- Импорт и запуск обработчика почты --- //
const { startEmailChecker } = require("./postamails");
startEmailChecker(telegramBot); // <-- Передаём бота, если требуется в твоём модуле

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

// --- Маршруты для вебхуков Mango Office (прокидываем telegramBot) --- //
fastify.post("/events/call", (req, res) => handleMangoWebhook(req, res, telegramBot));
fastify.post("/events/summary", (req, res) => handleMangoWebhook(req, res, telegramBot));

// --- Новый endpoint для назначения замера --- //
registerZamerRoute(fastify, telegramBot);

// И после registerZamerRoute добавьте:
registerTaskRoute(fastify, telegramBot);

// --- Регистрация маршрута готовности (добавить после других register) --- //
registerReadinessRoute(fastify, telegramBot);

// --- Подключаем push-маршруты (ВАЖНО: после объявления fastify, до listen!) --- //
registerPushRoutes(fastify);

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
  }
);
