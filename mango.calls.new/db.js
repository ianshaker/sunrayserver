const { supabase } = require("../lib/supabaseClient");
const {
    formatPhoneNumber,
    getManagerName,
    isOutgoingCall,
} = require("./format");

// Только цифры в формате 8XXXXXXXXXX (для client_phone_digits и поиска из CRM)
function phoneToDigits(phone) {
    if (!phone || typeof phone !== "string") return "";
    if (phone.includes("@")) return ""; // sip-адрес менеджера — не клиентский номер
    const d = phone.replace(/\D/g, "");
    if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return "8" + d.slice(1);
    if (d.length === 10) return "8" + d;
    return d;
}

// Unix-секунды Mango → ISO timestamptz (или null)
function unixToISO(sec) {
    if (!sec || typeof sec !== "number") return null;
    return new Date(sec * 1000).toISOString();
}

// Сохраняем итог звонка (summary) одной строкой; повторный summary обновит ту же строку
async function saveCallSummary(body, info) {
    const entryId = body.entry_id;
    if (!entryId) return;

    const outgoing = isOutgoingCall(body);

    // Входящий: клиент = from, менеджер = to (как раньше).
    // Исходящий: клиент = to (кому звонили), менеджер = from (кто звонил).
    let clientPhone, digits, managerName, managerExtension, managerPhone;
    if (outgoing) {
        const toNumber = body.to?.number;
        const fromNumber = body.from?.number;
        clientPhone = formatPhoneNumber(toNumber);
        digits = phoneToDigits(toNumber);
        managerName = getManagerName(fromNumber);
        managerExtension = body.from?.extension || null;
        managerPhone = fromNumber || null;
    } else {
        const fromNumber = body.from?.number;
        clientPhone = info.formattedFromNumber || formatPhoneNumber(fromNumber);
        digits = phoneToDigits(fromNumber);
        managerName = info.acceptedManager || info.managerName || null;
        managerExtension = body.to?.extension || null;
        managerPhone = body.to?.number || null;
    }

    const row = {
        entry_id: entryId,
        call_id: body.call_id || null,
        client_phone: clientPhone || "",
        client_phone_digits: digits || "",
        // direction должен быть согласован с полями выше (client/manager уже
        // переставлены под outgoing) — не берём body.call_direction напрямую,
        // т.к. isOutgoingCall() иногда решает "исходящий" по isManager(from)
        // даже если call_direction сам явно не равен 2.
        direction: outgoing ? 2 : (body.call_direction || 1),
        manager_name: managerName,
        manager_extension: managerExtension,
        manager_phone: managerPhone,
        line_number: info.lineNumber ? String(info.lineNumber) : null,
        line_name: info.lineName || null,
        call_started_at: unixToISO(body.create_time),
        call_answered_at: unixToISO(body.talk_time),
        call_ended_at: unixToISO(body.end_time),
        wait_seconds: info.timing?.waitSeconds || 0,
        ring_seconds: info.timing?.ringSeconds || 0,
        talk_seconds: info.timing?.talkSeconds || 0,
        total_seconds: info.timing?.totalSeconds || 0,
        answered: !!info.timing?.answered,
        disconnect_reason: body.disconnect_reason || null,
        disconnect_label: info.disconnectLabel || null,
    };

    // Исходящие не расшифровываем и не анализируем нейронкой — только храним
    // историю звонка и (позже) аудио. Ручной запуск расшифровки — отдельная задача.
    if (outgoing) {
        row.transcript_status = "skipped";
        row.transcript_error = "исходящий звонок — расшифровка не требуется";
        row.summary_status = "skipped";
        row.summary_error = "исходящий звонок — саммари не требуется";
    }

    // upsert по entry_id: при конфликте обновятся только переданные поля,
    // поля записи (recording_status/storage_path) останутся нетронутыми
    const { error } = await supabase
        .from("mango_calls")
        .upsert([row], { onConflict: "entry_id" });

    if (error) console.log("⚠️ mango_calls upsert(summary) error:", error.message);
}

// Обновляем поля записи в строке звонка; если строки ещё нет — создаём минимальную
async function updateCallRecordingMeta(entryId, fields) {
    const { data, error } = await supabase
        .from("mango_calls")
        .update(fields)
        .eq("entry_id", entryId)
        .select("id");

    if (error) {
        console.log("⚠️ mango_calls update(recording) error:", error.message);
        return;
    }

    if (!data || data.length === 0) {
        // запись пришла раньше summary — создаём заготовку (телефон дозаполнит summary)
        const { error: insErr } = await supabase
            .from("mango_calls")
            .insert([{ entry_id: entryId, client_phone: "", client_phone_digits: "", ...fields }]);
        if (insErr) console.log("⚠️ mango_calls insert(recording) error:", insErr.message);
    }
}

module.exports = {
    phoneToDigits,
    unixToISO,
    saveCallSummary,
    updateCallRecordingMeta,
};
