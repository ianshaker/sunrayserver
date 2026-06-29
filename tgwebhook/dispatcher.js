// ============================================================================
// Универсальный диспетчер апдейтов Telegram.
//
// Любой модуль подписывается на нужный тип события:
//   onMessage((msg, update) => {...})        — входящие сообщения
//   onCallbackQuery((cb, update) => {...})    — нажатия inline-кнопок
//   onUpdate((update) => {...})               — любой апдейт целиком
//
// Это и есть переиспользуемое ядро: напоминания, нейронки, новые отделы
// просто регистрируют свои хендлеры, не трогая транспорт вебхука.
// ============================================================================

const messageHandlers = [];
const callbackHandlers = [];
const updateHandlers = [];

// Защита от повторной доставки (Telegram может ретраить апдейт).
const RECENT_MAX = 500;
const recentOrder = [];
const recentSet = new Set();

function alreadySeen(updateId) {
  if (updateId == null) return false;
  if (recentSet.has(updateId)) return true;
  recentSet.add(updateId);
  recentOrder.push(updateId);
  if (recentOrder.length > RECENT_MAX) {
    const old = recentOrder.shift();
    recentSet.delete(old);
  }
  return false;
}

function onMessage(handler) {
  if (typeof handler === "function") messageHandlers.push(handler);
}

function onCallbackQuery(handler) {
  if (typeof handler === "function") callbackHandlers.push(handler);
}

function onUpdate(handler) {
  if (typeof handler === "function") updateHandlers.push(handler);
}

async function runHandlers(list, payload, update) {
  for (const handler of list) {
    try {
      await handler(payload, update);
    } catch (e) {
      console.error("[tgwebhook] ошибка хендлера:", e.message);
    }
  }
}

async function dispatchUpdate(update) {
  if (!update || typeof update !== "object") return;

  if (alreadySeen(update.update_id)) {
    console.log(`[tgwebhook] пропуск дубля update_id=${update.update_id}`);
    return;
  }

  await runHandlers(updateHandlers, update, update);

  if (update.message) {
    await runHandlers(messageHandlers, update.message, update);
  }
  if (update.callback_query) {
    await runHandlers(callbackHandlers, update.callback_query, update);
  }
}

module.exports = {
  onMessage,
  onCallbackQuery,
  onUpdate,
  dispatchUpdate,
};
