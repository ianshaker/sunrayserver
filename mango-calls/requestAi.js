// ============================================================================
// Ручной запрос AI (STT → саммари) по id строки mango_calls.
// Для исходящих из CRM; автоочередь входящих не трогаем.
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { triggerTranscription } = require("../call-ai");

/**
 * Ручной STT (force) по id. Длительность разговора не гейтим — достаточно файла.
 * Саммари дальше по правилам call-ai (короткий текст → raw-short без Gemini).
 *
 * @param {string} id — uuid mango_calls.id
 * @returns {Promise<{ status: string, id?: string, entry_id?: string, message?: string }>}
 */
async function requestAiForCall(id) {
  if (typeof id !== "string" || !id.trim()) {
    const err = new Error("Ожидается { id: string }");
    err.code = "invalid_body";
    throw err;
  }

  const { data, error } = await supabase
    .from("mango_calls")
    .select(
      "id, entry_id, recording_status, storage_path, transcript_status, summary_status, summary",
    )
    .eq("id", id.trim())
    .maybeSingle();

  if (error) {
    const err = new Error(error.message);
    err.code = "select_failed";
    throw err;
  }
  if (!data) {
    return { status: "not_found" };
  }

  // Единственный гейт «можно ли гонять» — файл в БД (storage_path + ready)
  if (data.recording_status !== "ready" || !data.storage_path) {
    return { status: "recording_not_ready", id: data.id, entry_id: data.entry_id };
  }

  if (
    data.transcript_status === "done" &&
    data.summary_status === "done" &&
    (data.summary || "").trim()
  ) {
    return { status: "already_done", id: data.id, entry_id: data.entry_id };
  }

  if (data.transcript_status === "processing" || data.summary_status === "processing") {
    return { status: "already_processing", id: data.id, entry_id: data.entry_id };
  }

  const { error: resetError } = await supabase
    .from("mango_calls")
    .update({
      transcript_status: "pending",
      transcript_error: null,
      summary_status: "pending",
      summary_error: null,
    })
    .eq("id", data.id);

  if (resetError) {
    const err = new Error(resetError.message);
    err.code = "reset_failed";
    throw err;
  }

  // STT может идти минуты — не ждём в HTTP-ответе
  triggerTranscription(data.entry_id, { force: true }).catch((e) =>
    console.error(`[mango-calls] request-ai STT ${data.entry_id}:`, e.message),
  );

  return { status: "started", id: data.id, entry_id: data.entry_id };
}

module.exports = { requestAiForCall };
