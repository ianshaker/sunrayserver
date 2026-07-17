// ============================================================================
// Telegram: AI-сводка звонка в чат входящих (тот же бот/чат, что mango.calls.new.js).
// ============================================================================

const { supabase } = require("./supabaseClient");

// mango.calls.new.js → TELEGRAM_CHAT_ID (чат «ВХОДЯЩИЕ»)
const TELEGRAM_CHAT_ID = -1002582438853;
const TELEGRAM_BATCH_LIMIT = 5;

let telegramBot = null;

function setTelegramBot(bot) {
  telegramBot = bot;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatCallDateTime(iso) {
  if (!iso) return "—";
  // Supabase хранит timestamptz (UTC); показываем менеджерам по Москве (+3).
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSummaryTelegramMessage(row) {
  const when = formatCallDateTime(row.call_started_at || row.call_answered_at);
  const phone = row.client_phone || "—";
  const manager = row.manager_name || "—";
  const summary = (row.summary || "").trim();
  // raw-short: summary уже содержит «В расшифровке — отказано. Диалог: …»
  const body =
    row.summary_model === "raw-short"
      ? `✨ ${escapeHtml(summary)}`
      : `✨ <b>Расшифровка AI-ассистентом:</b>\n${escapeHtml(summary)}`;

  return (
    `<b>ЗВОНОК</b>\n` +
    `от ${when}\n` +
    `Входящий: <b>${escapeHtml(phone)}</b>\n` +
    `Принял: <b>${escapeHtml(manager)}</b>\n` +
    `---\n` +
    body
  );
}

async function markTelegramSent(id) {
  const { error } = await supabase
    .from("mango_calls")
    .update({ summary_telegram_sent_at: new Date().toISOString() })
    .eq("id", id)
    .is("summary_telegram_sent_at", null);

  if (error) console.error("⚠️ summary_telegram_sent_at update:", error.message);
  return !error;
}

// Отправить сводку одного звонка. Только входящие (direction=1).
async function sendSummaryToTelegram(row) {
  if (!telegramBot) {
    console.warn("⚠️ Telegram-сводка: бот не инициализирован");
    return { ok: false, reason: "no_bot" };
  }
  if (row.direction !== 1) return { ok: false, reason: "not_incoming" };
  if (row.summary_status !== "done") return { ok: false, reason: "summary_not_ready" };
  if (row.summary_telegram_sent_at) return { ok: false, reason: "already_sent" };
  if (!row.summary || !row.summary.trim()) return { ok: false, reason: "empty_summary" };

  const text = buildSummaryTelegramMessage(row);
  if (text.length > 4096) {
    console.warn(`⚠️ Telegram-сводка ${row.entry_id}: ${text.length} симв., обрезаем до 4096`);
  }

  try {
    await telegramBot.sendMessage(TELEGRAM_CHAT_ID, text.slice(0, 4096), { parse_mode: "HTML" });
    await markTelegramSent(row.id);
    console.log(`📨 Telegram AI-сводка: ${row.entry_id}`);
    return { ok: true };
  } catch (e) {
    console.error(`❌ Telegram-сводка ${row.entry_id}:`, e.message);
    return { ok: false, reason: "send_failed" };
  }
}

const TELEGRAM_SELECT_FIELDS =
  "id, entry_id, direction, client_phone, manager_name, call_started_at, call_answered_at, summary, summary_status, summary_model, summary_telegram_sent_at";

// Догоняем сводки, которые готовы, но Telegram не ушёл (сбой сети и т.п.).
async function pollTelegramBacklog() {
  if (!telegramBot) return;

  const { data, error } = await supabase
    .from("mango_calls")
    .select(TELEGRAM_SELECT_FIELDS)
    .eq("summary_status", "done")
    .eq("direction", 1)
    .is("summary_telegram_sent_at", null)
    .not("summary", "is", null)
    .order("created_at", { ascending: true })
    .limit(TELEGRAM_BATCH_LIMIT);

  if (error) {
    console.error("⚠️ Telegram backlog select:", error.message);
    return;
  }
  if (!data?.length) return;

  for (const row of data) {
    await sendSummaryToTelegram(row);
  }
}

module.exports = {
  setTelegramBot,
  sendSummaryToTelegram,
  pollTelegramBacklog,
  buildSummaryTelegramMessage,
  TELEGRAM_CHAT_ID,
};
