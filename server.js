const path = require("path");
const fs = require("fs");
const fastify = require("fastify")({ logger: true });

// --- ИНТЕГРАЦИЯ TELEGRAM-БОТА --- //
const TelegramBot = require('node-telegram-bot-api');
const TELEGRAM_TOKEN = '7866133715:AAH2lSoDsDnmpQhEjSghjNb23ezp98IZW4g';
const telegramBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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
