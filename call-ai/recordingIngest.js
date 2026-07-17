// ============================================================================
// Приём mp3 от Selectel → Supabase Storage + mango_calls → async STT.
// Один Buffer: без повторного скачивания из Storage для этого же запроса.
// ============================================================================

const { supabase } = require("./supabaseClient");
const { CALL_RECORDINGS_BUCKET } = require("./config");
const { transcribeRow } = require("./transcription");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIRECTION_RETRY_ATTEMPTS = 4;
const DIRECTION_RETRY_MS = 5000;

function buildStoragePath(recordingId, entryId) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safe = String(recordingId || entryId).replace(/[^A-Za-z0-9._-]/g, "_");
  return `${yyyy}/${mm}/${safe}.mp3`;
}

/** Summary уже дописал строку (не голая заготовка с default direction=1). */
function hasSummaryMeta(row) {
  if (!row) return false;
  if (row.call_started_at) return true;
  if (row.client_phone_digits && String(row.client_phone_digits).trim()) return true;
  return false;
}

async function upsertRecordingReady({ entryId, recordingId, storagePath, sizeBytes }) {
  const fields = {
    recording_id: recordingId || null,
    recording_status: "ready",
    storage_bucket: CALL_RECORDINGS_BUCKET,
    storage_path: storagePath,
    recording_size_bytes: sizeBytes,
  };

  const { data: existing, error: selErr } = await supabase
    .from("mango_calls")
    .select("id, entry_id, direction, transcript_status, call_started_at, client_phone_digits")
    .eq("entry_id", entryId)
    .maybeSingle();

  if (selErr) {
    throw new Error(`select mango_calls: ${selErr.message}`);
  }

  if (existing) {
    const { error: updErr } = await supabase
      .from("mango_calls")
      .update(fields)
      .eq("id", existing.id);
    if (updErr) throw new Error(`update mango_calls: ${updErr.message}`);
    return { ...existing, ...fields };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("mango_calls")
    .insert({
      entry_id: entryId,
      client_phone: "",
      client_phone_digits: "",
      transcript_status: "pending",
      summary_status: "pending",
      ...fields,
    })
    .select("id, entry_id, direction, transcript_status, call_started_at, client_phone_digits")
    .maybeSingle();

  if (insErr) throw new Error(`insert mango_calls: ${insErr.message}`);
  return inserted;
}

async function uploadBufferToStorage(storagePath, buffer) {
  const { error } = await supabase.storage
    .from(CALL_RECORDINGS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
  if (error) throw new Error(`storage upload: ${error.message}`);
}

/**
 * После ACK: ждём meta summary (direction), затем STT из того же buffer.
 */
async function maybeStartSttAfterIngest(entryId, audioBuffer) {
  if (!entryId || !audioBuffer) return;

  for (let attempt = 1; attempt <= DIRECTION_RETRY_ATTEMPTS; attempt++) {
    const { data: row, error } = await supabase
      .from("mango_calls")
      .select(
        "id, entry_id, direction, talk_seconds, storage_bucket, storage_path, transcript_status, recording_status, call_started_at, client_phone_digits",
      )
      .eq("entry_id", entryId)
      .maybeSingle();

    if (error) {
      console.error(`[recordingIngest] select ${entryId}:`, error.message);
      return;
    }
    if (!row) {
      await sleep(DIRECTION_RETRY_MS);
      continue;
    }

    if (!hasSummaryMeta(row)) {
      console.log(
        `[recordingIngest] ${entryId}: ждём summary (attempt ${attempt}/${DIRECTION_RETRY_ATTEMPTS})`,
      );
      await sleep(DIRECTION_RETRY_MS);
      continue;
    }

    if (row.direction === 2) {
      console.log(`[recordingIngest] ${entryId}: исходящий — STT не стартуем (файл в Storage)`);
      if (row.transcript_status === "pending") {
        await supabase
          .from("mango_calls")
          .update({
            transcript_status: "skipped",
            transcript_error: "исходящий звонок — расшифровка по запросу из CRM",
            summary_status: "skipped",
            summary_error: "исходящий звонок — саммари не требуется",
          })
          .eq("id", row.id);
      }
      return;
    }

    if (row.direction === 1) {
      if (row.transcript_status === "done" || row.transcript_status === "processing") {
        return;
      }
      // Тот же Buffer — без скачивания из Storage
      await transcribeRow(row, { audioBuffer });
      return;
    }

    await sleep(DIRECTION_RETRY_MS);
  }

  console.log(
    `[recordingIngest] ${entryId}: summary не подошёл вовремя — safety-sweep догонит STT`,
  );
}

/**
 * Сохранить файл + ACK. STT — fire-and-forget после ответа.
 */
async function ingestRecordingUpload({ entryId, recordingId, buffer }) {
  if (!entryId) {
    const err = new Error("Нужен X-Entry-Id");
    err.code = "missing_entry_id";
    throw err;
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    const err = new Error("Пустое тело audio/mpeg");
    err.code = "empty_body";
    throw err;
  }

  const storagePath = buildStoragePath(recordingId, entryId);
  await uploadBufferToStorage(storagePath, buffer);
  const row = await upsertRecordingReady({
    entryId,
    recordingId,
    storagePath,
    sizeBytes: buffer.length,
  });

  console.log(
    `[recordingIngest] ready entry=${entryId} path=${storagePath} bytes=${buffer.length}`,
  );

  // STT после ACK — не блокируем Selectel на минуты Google
  setImmediate(() => {
    maybeStartSttAfterIngest(entryId, buffer).catch((e) =>
      console.error(`[recordingIngest] STT ${entryId}:`, e.message),
    );
  });

  return {
    status: "ok",
    entry_id: entryId,
    storage_path: storagePath,
    size: buffer.length,
    id: row?.id || null,
  };
}

function registerRecordingUploadRoute(fastify, checkSelectelIP) {
  fastify.addContentTypeParser(
    "audio/mpeg",
    { parseAs: "buffer", bodyLimit: 55 * 1024 * 1024 },
    (_req, body, done) => {
      done(null, body);
    },
  );

  fastify.post(
    "/internal/recording-upload",
    { preHandler: checkSelectelIP, bodyLimit: 55 * 1024 * 1024 },
    async (request, reply) => {
      const entryId = request.headers["x-entry-id"];
      const recordingId = request.headers["x-recording-id"] || null;
      const buffer = request.body;

      try {
        const result = await ingestRecordingUpload({
          entryId: typeof entryId === "string" ? entryId.trim() : "",
          recordingId: recordingId && String(recordingId).trim() ? String(recordingId).trim() : null,
          buffer,
        });
        return reply.send(result);
      } catch (e) {
        const code = e.code || "ingest_failed";
        const status = code === "missing_entry_id" || code === "empty_body" ? 400 : 500;
        console.error(`[recordingIngest] error:`, e.message);
        return reply.code(status).send({ status: "error", error: code, message: e.message });
      }
    },
  );
}

module.exports = {
  registerRecordingUploadRoute,
  ingestRecordingUpload,
  maybeStartSttAfterIngest,
};
