// Диагностические команды — проверка, что входящий канал жив, и удобный
// способ узнать chat_id (пригодится для привязки сотрудников/чатов к отделам).
//
//   /ping  → "pong" + время сервера
//   /id    → chat_id, тип чата, данные отправителя
//
// Это не бизнес-логика — просто утилита поверх универсального диспетчера.

const { onMessage } = require("../dispatcher");
const { getTelegramBot } = require("../bot");

async function reply(chatId, text) {
  const bot = getTelegramBot();
  if (!bot) {
    console.warn("[tgwebhook] нет telegramBot для ответа на команду");
    return;
  }
  await bot.sendMessage(chatId, text, { disable_web_page_preview: true });
}

function registerDiagnosticsHandlers() {
  onMessage(async (msg) => {
    const text = (msg.text || "").trim();
    if (!text) return;

    const chat = msg.chat || {};
    const from = msg.from || {};

    // Команды могут приходить как "/id" или "/id@bot_username".
    const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

    if (command === "/ping") {
      await reply(chat.id, `pong · ${new Date().toISOString()}`);
      return;
    }

    if (command === "/id") {
      const lines = [
        "🆔 Идентификаторы",
        `chat_id: ${chat.id}`,
        `chat_type: ${chat.type || "—"}`,
        chat.title ? `chat_title: ${chat.title}` : null,
        `from_id: ${from.id}`,
        from.username ? `from_username: @${from.username}` : null,
        `from_name: ${[from.first_name, from.last_name].filter(Boolean).join(" ") || "—"}`,
      ].filter(Boolean);
      await reply(chat.id, lines.join("\n"));
      return;
    }
  });

  console.log("[tgwebhook] диагностические команды активны: /ping, /id");
}

module.exports = { registerDiagnosticsHandlers };
