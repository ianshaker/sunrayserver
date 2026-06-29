// Намерение «вебхук должен быть включён» + последний статус — в Supabase.
// Нужно для self-heal: после рестарта/redeploy сервер знает, что вебхук
// надо держать активным, и переустанавливает его, если Telegram «слетел».
// Работает best-effort: если таблицы нет — просто логируем и продолжаем.

const { supabase } = require("../lib/supabaseClient");

const STATE_ID = "default";
const TABLE = "telegram_webhook_state";

async function readState() {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", STATE_ID)
      .maybeSingle();
    if (error) {
      console.error("[tgwebhook] чтение состояния:", error.message);
      return null;
    }
    return data || null;
  } catch (e) {
    console.error("[tgwebhook] чтение состояния:", e.message);
    return null;
  }
}

async function writeState(patch) {
  try {
    const row = Object.assign(
      { id: STATE_ID, updated_at: new Date().toISOString() },
      patch || {},
    );
    const { error } = await supabase.from(TABLE).upsert(row);
    if (error) {
      console.error(
        "[tgwebhook] запись состояния:",
        error.message,
        "(применена ли миграция telegram_webhook_state?)",
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("[tgwebhook] запись состояния:", e.message);
    return false;
  }
}

module.exports = { readState, writeState, STATE_ID };
