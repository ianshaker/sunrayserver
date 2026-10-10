// Держатель экземпляра node-telegram-bot-api для отправки ответов из хендлеров.
// server.js создаёт бота один раз и кладёт сюда через setTelegramBot().
//
// Нейробот в CRM (PLANS/CRM/18-neyrobot-na-glavnoy, буква А): на время запроса из CRM getTelegramBot() отдаёт
// «бота CRM» (assistant/crmBot.js) — умения не переписываются, их ответы в свой чат копятся для CRM.
// Вне runWithBot() — всегда настоящий бот.

const { AsyncLocalStorage } = require("node:async_hooks");

let telegramBot = null;
const botOfRequest = new AsyncLocalStorage();

function setTelegramBot(bot) {
  telegramBot = bot;
}

function getTelegramBot() {
  return botOfRequest.getStore() || telegramBot;
}

/** Настоящий бот — «боту CRM», чтобы слать в чужие чаты мимо подмены */
function getRealTelegramBot() {
  return telegramBot;
}

/** Выполнить fn так, что getTelegramBot() внутри (и во всём, что она ждёт) отдаёт bot */
function runWithBot(bot, fn) {
  return botOfRequest.run(bot, fn);
}

module.exports = { setTelegramBot, getTelegramBot, getRealTelegramBot, runWithBot };
