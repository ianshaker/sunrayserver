// ============================================================================
// Суточная сводка по почте: одно сообщение в чат утром.
//
// Смысл: тишина в чате не должна быть неотличима от «заявок не было».
// Разбор писем ломался месяц именно потому, что об этом никто не сообщал.
// ============================================================================

const { supabase } = require("../supabaseClient");
const { notifyIncomingChat } = require("../telegramNotify");

const DAY_MS = 24 * 60 * 60 * 1000;

const TITLES = {
  created: "Заявок заведено",
  duplicate: "Повторных обращений",
  contract: "Узнали клиента по договору",
  no_phone: "Без номера, ушли текстом",
  blacklisted: "Отбито чёрным списком",
  error: "Сбоев разбора",
};

/** Читает журнал за сутки. Возвращает null, если журнал недоступен. */
async function readLastDay() {
  const since = new Date(Date.now() - DAY_MS).toISOString();

  const { data, error } = await supabase
    .from("gmail_processed_messages")
    .select("outcome, spam_reason")
    .gte("processed_at", since);

  if (error) {
    // Колонки spam_reason может ещё не быть — читаем без неё.
    const retry = await supabase
      .from("gmail_processed_messages")
      .select("outcome")
      .gte("processed_at", since);

    if (retry.error) {
      console.error("[postamails/сводка] журнал не прочитан:", retry.error.message);
      return null;
    }
    return retry.data || [];
  }

  return data || [];
}

function buildDigest(rows) {
  const counts = {};
  let marked = 0;

  for (const row of rows) {
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    if (row.spam_reason) marked += 1;
  }

  let text = "📊 <b>Почта за сутки</b>\n";
  for (const [outcome, title] of Object.entries(TITLES)) {
    text += `${title}: <b>${counts[outcome] || 0}</b>\n`;
  }
  text += `Помечено «вероятно спам»: <b>${marked}</b>`;

  const unparsed = (counts.no_phone || 0) + (counts.error || 0);
  if (unparsed) {
    text += `\n\n⚠️ Не разобрано писем: <b>${unparsed}</b> — стоит заглянуть в почту.`;
  }

  return text;
}

/** Считает сутки и шлёт сводку. Писем не было — молчит. */
async function sendDailyDigest() {
  const rows = await readLastDay();
  if (rows === null) return;

  if (!rows.length) {
    console.log("[postamails/сводка] за сутки писем не было — не шлём");
    return;
  }

  await notifyIncomingChat(buildDigest(rows));
  console.log(`[postamails/сводка] отправлена, писем за сутки: ${rows.length}`);
}

module.exports = { sendDailyDigest, buildDigest };
