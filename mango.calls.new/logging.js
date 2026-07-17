const fs = require("fs");
const path = require("path");

const MANGO_DEBUG_LOG = process.env.MANGO_DEBUG_LOG !== "false";
const MANGO_LOG_FILE = path.join(__dirname, "..", "mango_webhook_debug.jsonl");

// off | compact (default) | verbose — полный RAW/PARSED JSON только в verbose.
function getMangoLogLevel() {
    if (process.env.MANGO_DEBUG_LOG === "false") return "off";
    return process.env.MANGO_LOG_LEVEL || "compact";
}

function shortEntryId(entryId) {
    if (!entryId) return "—";
    const s = String(entryId);
    return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

function shouldLogCompactCall(body) {
    if (body.call_direction !== undefined) return true;
    if (body.call_state === "Disconnected") return true;
    if (body.call_state === "Appeared" && body.location === "ivr") return true;
    return false;
}

function logMangoCompact(request, body) {
    const eventType = classifyMangoEvent(body);
    const from = body.from?.number || "?";
    const to = body.to?.number || "?";
    const entry = shortEntryId(body.entry_id || body.call_id);

    if (body.call_direction !== undefined) {
        const dir = body.call_direction === 1 ? "вх" : body.call_direction === 2 ? "исх" : body.call_direction;
        const ans = body.answered ? "ответили" : "не ответили";
        const talk = body.talk_time != null ? `, разговор ${body.talk_time}с` : "";
        console.log(
            `🍋 summary ${dir}, ${ans}${talk} | ${from} → ${to} | entry=${entry}`,
        );
        return;
    }

    const extra =
        body.call_state === "Disconnected" && body.disconnect_reason != null
            ? `, код ${body.disconnect_reason}`
            : "";
    console.log(`🍋 ${eventType}${extra} | ${from} → ${to} | entry=${entry} | ${request.url}`);
}

function classifyMangoEvent(body) {
    if (body.call_state) {
        return `call → ${body.call_state} @ ${body.location || "?"}`;
    }
    if (body.call_direction !== undefined && body.from && body.to) {
        const dir = body.call_direction === 1 ? "входящий" : body.call_direction === 2 ? "исходящий" : body.call_direction;
        return `summary → ${dir}`;
    }
    return "unknown";
}

function redactSecrets(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const copy = { ...obj };
    if (copy.vpbx_api_key) copy.vpbx_api_key = "[скрыт]";
    if (copy.sign) copy.sign = "[скрыт]";
    return copy;
}

function logMangoWebhook(request, rawBody, parsedBody) {
    const level = getMangoLogLevel();
    if (level === "off") return;

    const eventType = classifyMangoEvent(parsedBody);
    const time = new Date().toISOString();

    if (level === "compact") {
        if (shouldLogCompactCall(parsedBody)) {
            logMangoCompact(request, parsedBody);
        }
        return;
    }

    const divider = "═".repeat(72);

    const logEntry = {
        time,
        path: request.url,
        event: eventType,
        call_id: parsedBody.call_id || parsedBody.entry_id || null,
        raw: rawBody,
        parsed: parsedBody,
    };

    console.log(`\n${divider}`);
    console.log(`🍋 MANGO WEBHOOK  ${time}`);
    console.log(`   URL:    ${request.url}`);
    console.log(`   Тип:    ${eventType}`);
    if (logEntry.call_id) console.log(`   call_id: ${logEntry.call_id}`);
    console.log(`${divider}`);
    console.log("📦 RAW (как пришло от Mango):");
    console.log(JSON.stringify(redactSecrets(rawBody), null, 2));
    console.log("📋 PARSED (распарсенный json):");
    console.log(JSON.stringify(redactSecrets(parsedBody), null, 2));
    console.log(`${divider}\n`);

    if (!MANGO_DEBUG_LOG) return;

    try {
        fs.appendFileSync(MANGO_LOG_FILE, JSON.stringify(logEntry) + "\n");
    } catch (e) {
        console.log("⚠️ Не удалось записать mango_webhook_debug.jsonl:", e.message);
    }
}

module.exports = { logMangoWebhook };
