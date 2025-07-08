// pushmodul.js

const webpush = require("web-push");

// Импортируй свои ключи! (подключи файл с ключами или вставь их тут)
const VAPID_PUBLIC_KEY = "BOfUdg5mhMDUsUTJS_QFDjJGoedSd4sA53iyriJaZn1nn9KkRf08giPq7oXAhXmUMfwdhHBYq0ZSmab0qzAfrKk";
const VAPID_PRIVATE_KEY = "eyoy_mOuvBTkQx0eqfH7Jdz2lUixoTO2BVqnJZr09i8";

webpush.setVapidDetails(
  'mailto:your@email.com', // лучше свой email
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Для теста — просто массив (можно потом сделать БД)
const subscriptions = [];

// Регистрация всех push-маршрутов
function registerPushRoutes(fastify) {
  // Эндпоинт для регистрации подписки
  fastify.post("/api/subscribe", async (request, reply) => {
    const subscription = request.body;
    subscriptions.push(subscription); // Сохраняем в памяти (на время жизни сервера)
    reply.code(201).send({ message: "Подписка сохранена" });
  });

  // Эндпоинт для отправки пуша всем (для теста)
  fastify.post("/api/send-push", async (request, reply) => {
    const { title, body } = request.body || {};
    let success = 0, fail = 0;

    // Пробегаем по всем подпискам
    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify({ title, body }));
        success++;
      } catch (e) {
        fail++;
      }
    }));

    reply.send({ sent: success, failed: fail, total: subscriptions.length });
  });

  // Получение публичного ключа для фронта
  fastify.get("/api/public-key", async (req, reply) => {
    reply.send({ publicKey: VAPID_PUBLIC_KEY });
  });
}

module.exports = { registerPushRoutes };