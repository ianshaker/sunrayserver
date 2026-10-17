"use strict";

// Замок вебхуков Манго: общий секрет от нашего прокси (заголовок x-proxy-secret).
// Пока секрет не задан — прежняя проверка по адресу Selectel-прокси, без смены поведения.
// Переменные: MANGO_PROXY_SECRET — секрет; MANGO_PROXY_SECRET_REQUIRED=1 — пускать только с секретом.
// Секрет и значение заголовка в журнал не пишем никогда.

const crypto = require("crypto");

const SELECTEL_IP = "135.106.155.17";
const ZAGOLOVOK_SEKRETA = "x-proxy-secret";

// Сравнение секрета без утечки по времени; другая длина — не совпал.
function sekretSovpal(zagolovok, sekret) {
  if (typeof zagolovok !== "string") return false;
  const a = Buffer.from(zagolovok);
  const b = Buffer.from(sekret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sozdatZamok({ env = process.env, log } = {}) {
  const sekret = env.MANGO_PROXY_SECRET ? String(env.MANGO_PROXY_SECRET) : "";
  const trebovat = env.MANGO_PROXY_SECRET_REQUIRED === "1";

  return async function zamokProksi(req, reply) {
    const predupredit = (soobshchenie) => {
      const zhurnal = log || req.log;
      if (zhurnal && typeof zhurnal.warn === "function") zhurnal.warn(soobshchenie);
    };

    const zagolovki = req.headers || {};

    if (sekret !== "" && sekretSovpal(zagolovki[ZAGOLOVOK_SEKRETA], sekret)) {
      req.mangoProxySecretOk = true;
      return;
    }

    if (trebovat) {
      predupredit("замок прокси: без секрета/не совпал");
      return reply.code(403).send({ error: "Forbidden" });
    }

    // Прежняя проверка по адресу — как была в server.js.
    const ip =
      zagolovki["x-forwarded-for"]?.split(",")[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress;

    const cleanIp = ip?.replace("::ffff:", "");

    if (cleanIp !== SELECTEL_IP) {
      predupredit(`Mango webhook rejected from IP: ${cleanIp}`);
      return reply.code(403).send({ error: "Forbidden" });
    }

    // Секрет задан, а прокси его не прислал или прислал не тот — видно по журналу Render.
    if (sekret !== "") {
      predupredit("замок прокси: запрос без секрета, пропущен по адресу");
    }
  };
}

module.exports = { sozdatZamok };
