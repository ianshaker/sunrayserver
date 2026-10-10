// ============================================================================
// Нейробот в CRM — сообщение человека из CRM идёт тем же путём, что из Telegram
// (PLANS/CRM/18-neyrobot-na-glavnoy, буква Б).
//
// Отличия от Telegram только во входе: человек — из пропуска CRM, а не по telegram_user_id; права — его личного
// чата в «Telegram-чаты бота» (О1 = А); отвечает «бот CRM» (буква А) в постоянный чат CRM человека. Дальше —
// obrabotatZapros, как у buildContext: тот же роутер, те же умения, те же тексты.
// ============================================================================

const { runWithBot } = require("../tgwebhook/bot");
const { getPersonalChatByProfile } = require("../lib/telegramBotChats");
const { getEnabledIntents } = require("./registry");
const { StatusMessage } = require("./statusMessage");
const { obrabotatZapros } = require("./obrabotka");
const { CrmBot, crmChatIdFor } = require("./crmBot");
const { REPLIES, ASSISTANT_DISABLED, ADMIN_TELEGRAM_USERNAME } = require("./config");

const NET_LICHNOGO_CHATA = [
  "🚫 Чтобы писать мне из CRM, нужен ваш личный чат с ботом.",
  "",
  `Обратитесь к @${ADMIN_TELEGRAM_USERNAME} — подключит его в «Настройки → Telegram-чаты бота».`,
].join("\n");

const NET_PRAV = [
  "🚫 В вашем личном чате у бота нет разрешений.",
  "",
  `Обратитесь к @${ADMIN_TELEGRAM_USERNAME} — настроит права в «Настройки → Telegram-чаты бота».`,
].join("\n");

async function obrabotat(bot, chatId, profileId, text) {
  if (ASSISTANT_DISABLED) {
    await bot.sendMessage(chatId, REPLIES.DISABLED);
    return;
  }

  const lichnyy = await getPersonalChatByProfile(profileId);
  if (!lichnyy) {
    console.log(`[assistant] CRM: нет личного чата у profile=${profileId}`);
    await bot.sendMessage(chatId, NET_LICHNOGO_CHATA);
    return;
  }

  const enabledIntents = getEnabledIntents(lichnyy.permissions);
  if (!enabledIntents.length) {
    console.log(`[assistant] CRM: у личного чата «${lichnyy.title}» нет прав`);
    await bot.sendMessage(chatId, NET_PRAV);
    return;
  }

  const statusMsg = new StatusMessage(bot, chatId, null, { minMs: 0 });
  await statusMsg.send("⏳ Изучаю запрос...");

  // Тот же ctx, что собирает buildContext: чат — личный чат человека, но номер — чата CRM, куда отвечать
  const ctx = {
    bot,
    chat: { ...lichnyy, chatId, title: `CRM · ${lichnyy.title}` },
    profileId,
    msg: { message_id: 0, chat: { id: chatId, type: "private" }, from: null, text, date: Math.floor(Date.now() / 1000) },
    text,
    replyText: null,
    replyFrom: null,
    replyUnsupported: null,
    replyVoiceFailed: null,
    chatId,
    enabledIntents,
    statusMsg,
    istochnik: "crm",
  };

  console.log(
    `[assistant] вход CRM: профиль ${profileId}, личный чат «${lichnyy.title}», ` +
      `intents=[${enabledIntents.map((i) => i.name).join(",")}], ` +
      `text="${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`,
  );

  try {
    await obrabotatZapros(ctx);
  } catch (error) {
    console.error("[assistant] CRM: ошибка обработки:", error.stack || error.message);
    if (statusMsg.messageId) await statusMsg.update(REPLIES.ERROR, 0);
    else await bot.sendMessage(chatId, REPLIES.ERROR);
  }
}

/**
 * @param {{ profileId: string, text: string }} zapros — text уже обрезан и не пустой (assistant/crmRoutes.js)
 * @returns {Promise<{ messages: object[], deleted: number[], toasts: string[], vChuzhieChaty: number }>}
 */
async function soobshchenieIzCrm({ profileId, text }) {
  const chatId = crmChatIdFor(profileId);
  const bot = new CrmBot(chatId);
  await runWithBot(bot, () => obrabotat(bot, chatId, profileId, text));
  return { ...bot.otvet(), vChuzhieChaty: bot.vChuzhieChaty };
}

module.exports = { soobshchenieIzCrm, NET_LICHNOGO_CHATA, NET_PRAV };
