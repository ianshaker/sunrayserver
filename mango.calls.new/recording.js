const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const { supabase } = require("../lib/supabaseClient");
const { CALL_RECORDINGS_BUCKET } = require("./constants");
const { logMangoWebhook } = require("./logging");
const { updateCallRecordingMeta } = require("./db");

// ============================================================================
// === ЗАПИСИ РАЗГОВОРОВ: сохранение в Supabase ===============================
// ============================================================================

// GET с возвратом Buffer, следуем за редиректами (Mango отдаёт mp3 через redirect)
function httpGetBuffer(urlStr, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(e); }
        const lib = u.protocol === "http:" ? http : https;
        lib.get(u, (res) => {
            const status = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
                res.resume();
                const next = new URL(res.headers.location, u).toString();
                return resolve(httpGetBuffer(next, redirectsLeft - 1));
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ statusCode: status, headers: res.headers, body: Buffer.concat(chunks) }));
        }).on("error", reject);
    });
}

// POST form-urlencoded БЕЗ следования за редиректом (нужен заголовок Location)
function httpPostFormNoRedirect(urlStr, formStr) {
    return new Promise((resolve, reject) => {
        let u;
        try { u = new URL(urlStr); } catch (e) { return reject(e); }
        const lib = u.protocol === "http:" ? http : https;
        const req = lib.request(u, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(formStr),
            },
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", reject);
        req.write(formStr);
        req.end();
    });
}

function encodeForm(obj) {
    return Object.entries(obj)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
}

// Скачиваем mp3: сначала по ссылке из webhook, затем (если есть ключ+соль) через API Mango
async function downloadRecordingBuffer(body) {
    // 1) Прямая ссылка из уведомления
    if (body.recording_url) {
        try {
            const r = await httpGetBuffer(body.recording_url);
            if (r.statusCode === 200 && r.body.length > 0) return r.body;
        } catch (e) {
            console.log("⚠️ Ошибка скачивания по recording_url:", e.message);
        }
    }

    // 2) API Mango (нужны MANGO_VPBX_API_KEY + MANGO_VPBX_API_SALT в env)
    const key = process.env.MANGO_VPBX_API_KEY;
    const salt = process.env.MANGO_VPBX_API_SALT;
    if (body.recording_id && key && salt) {
        try {
            const json = JSON.stringify({ recording_id: body.recording_id, action: "download" });
            const sign = crypto.createHash("sha256").update(key + json + salt).digest("hex");
            const form = encodeForm({ vpbx_api_key: key, sign, json });
            const resp = await httpPostFormNoRedirect(
                "https://app.mango-office.ru/vpbx/queries/recording/post",
                form
            );
            const loc = resp.headers.location;
            if (loc) {
                const r = await httpGetBuffer(loc);
                if (r.statusCode === 200 && r.body.length > 0) return r.body;
            }
        } catch (e) {
            console.log("⚠️ Ошибка скачивания через API Mango:", e.message);
        }
    }

    return null;
}

// Обработчик /events/recording и /events/record/added
async function handleMangoRecording(request, reply) {
    const rawBody = request.body ? { ...request.body } : {};
    let body = { ...rawBody };

    if (typeof body.json === "string") {
        try {
            body = { ...body, ...JSON.parse(body.json) };
        } catch (e) {
            logMangoWebhook(request, rawBody, { parse_error: e.message });
            return reply.code(400).send({ error: "Bad json" });
        }
    }

    logMangoWebhook(request, rawBody, body);

    const entryId = body.entry_id;
    const recordingId = body.recording_id || null;
    const state = body.recording_state;

    if (!entryId) return reply.send({ status: "no_entry_id" });

    // Готов ли файл к скачиванию
    const isReady =
        !!body.recording_url ||
        state === "Completed" ||
        String(request.url || "").includes("record/added");

    if (!isReady) {
        // Промежуточный статус (например Started) — просто фиксируем
        await updateCallRecordingMeta(entryId, {
            recording_id: recordingId,
            mango_recording_url: body.recording_url || null,
        });
        return reply.send({ status: "recording_state_noted" });
    }

    try {
        await updateCallRecordingMeta(entryId, {
            recording_id: recordingId,
            mango_recording_url: body.recording_url || null,
            recording_status: "downloading",
        });

        const buf = await downloadRecordingBuffer(body);
        if (!buf) {
            await updateCallRecordingMeta(entryId, { recording_status: "failed" });
            return reply.send({ status: "download_failed" });
        }

        const now = new Date();
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
        const safe = String(recordingId || entryId).replace(/[^A-Za-z0-9._-]/g, "_");
        const storagePath = `${yyyy}/${mm}/${safe}.mp3`;

        const { error: upErr } = await supabase.storage
            .from(CALL_RECORDINGS_BUCKET)
            .upload(storagePath, buf, { contentType: "audio/mpeg", upsert: true });

        if (upErr) {
            console.log("⚠️ Storage upload error:", upErr.message);
            await updateCallRecordingMeta(entryId, { recording_status: "failed" });
            return reply.send({ status: "storage_error" });
        }

        await updateCallRecordingMeta(entryId, {
            recording_id: recordingId,
            recording_status: "ready",
            storage_bucket: CALL_RECORDINGS_BUCKET,
            storage_path: storagePath,
            recording_size_bytes: buf.length,
            mango_recording_url: body.recording_url || null,
        });

        return reply.send({ status: "recording_saved", path: storagePath });
    } catch (e) {
        console.log("⚠️ Recording handler error:", e.message);
        await updateCallRecordingMeta(entryId, { recording_status: "failed" }).catch(() => {});
        return reply.send({ status: "error" });
    }
}

module.exports = { handleMangoRecording };
