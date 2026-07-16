// ============================================================================
// HTTP: ручная генерация / статус / админ превью+commit фактов дня.
//   POST /api/daily-highlights/generate?key=...
//   GET  /api/daily-highlights/status?key=...
//   GET  /api/daily-highlights/admin?date=...          Bearer superadmin
//   POST /api/daily-highlights/preview                 Bearer superadmin → INSERT preview
//   POST /api/daily-highlights/commit                  Bearer superadmin → preview→ready
//   POST /api/daily-highlights/discard                 Bearer superadmin → DELETE preview
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { SETUP_SECRET } = require("./config");
const { assertSuperAdminFromRequest } = require("../lib/telegramBotChatsAdmin");
const {
  generateDailyHighlights,
  getAdminSlotsForDate,
  previewHighlightSlots,
  commitHighlightBatch,
  discardPreview,
  mskDateString,
  yesterdayMskDateString,
  isValidDateStr,
} = require("./generate");

function checkSetupKey(key) {
  if (!SETUP_SECRET) return true;
  return typeof key === "string" && key.length > 0 && key === SETUP_SECRET;
}

function registerHomeHighlightsRoutes(fastify) {
  fastify.post("/api/daily-highlights/generate", async (request, reply) => {
    const key = request.query?.key || request.headers["x-setup-key"] || "";
    if (!checkSetupKey(key)) {
      return reply.code(403).send({ status: "error", error: "forbidden" });
    }

    const date = request.query?.date || request.body?.date || null;
    if (date && !isValidDateStr(date)) {
      return reply.code(400).send({ status: "error", error: "invalid_date", hint: "YYYY-MM-DD" });
    }

    const result = await generateDailyHighlights(date || undefined);
    const code = result.status === "error" ? 500 : result.status === "disabled" ? 503 : 200;
    return reply.code(code).send(result);
  });

  fastify.get("/api/daily-highlights/status", async (request, reply) => {
    const key = request.query?.key || "";
    if (!checkSetupKey(key)) {
      return reply.code(403).send({ status: "error", error: "forbidden" });
    }
    const yesterday = yesterdayMskDateString();
    const { data, error } = await supabase
      .from("home_daily_highlights")
      .select("batch_id, highlight_date, slot, status, text, bot_comment, source_entry_id, created_at")
      .eq("highlight_date", yesterday)
      .order("created_at", { ascending: false })
      .order("slot", { ascending: true });

    if (error) {
      return reply.code(500).send({ status: "error", message: error.message });
    }

    const rows = data || [];
    const latestBatchId = rows[0]?.batch_id || null;
    const latestBatchRows = latestBatchId
      ? rows.filter((r) => r.batch_id === latestBatchId).sort((a, b) => a.slot - b.slot)
      : [];

    return reply.send({
      status: "ok",
      highlight_date: yesterday,
      today_msk: mskDateString(),
      latest_batch_id: latestBatchId,
      batches: [...new Set(rows.map((r) => r.batch_id).filter(Boolean))].length,
      rows: latestBatchRows,
      all_rows: rows,
    });
  });

  // —— CRM Settings (superadmin) ——

  fastify.get("/api/daily-highlights/admin", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const date = request.query?.date || yesterdayMskDateString();
    if (!isValidDateStr(date)) {
      return reply.code(400).send({ status: "error", error: "invalid_date" });
    }

    try {
      const batch = await getAdminSlotsForDate(date);
      const ids = batch.rows.map((r) => r.id).filter(Boolean);
      let repliesByHighlight = {};

      if (ids.length > 0) {
        const { data: replies, error: repliesError } = await supabase
          .from("home_daily_highlight_replies")
          .select("id, highlight_id, author_name, body, created_at")
          .in("highlight_id", ids)
          .order("created_at", { ascending: true });

        if (repliesError) {
          console.warn("[home-highlights] admin replies:", repliesError.message);
        } else {
          for (const r of replies || []) {
            if (!repliesByHighlight[r.highlight_id]) repliesByHighlight[r.highlight_id] = [];
            repliesByHighlight[r.highlight_id].push(r);
          }
        }
      }

      return reply.send({
        status: "ok",
        highlight_date: date,
        today_msk: mskDateString(),
        yesterday_msk: yesterdayMskDateString(),
        batch_id: batch.batch_id,
        rows: batch.rows.map((row) => ({
          ...row,
          replies: repliesByHighlight[row.id] || [],
        })),
      });
    } catch (e) {
      return reply.code(500).send({ status: "error", message: e.message });
    }
  });

  fastify.post("/api/daily-highlights/preview", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const body = request.body || {};
    const date = body.date || yesterdayMskDateString();
    if (!isValidDateStr(date)) {
      return reply.code(400).send({ status: "error", error: "invalid_date" });
    }

    let slots = body.slots;
    if (body.slot != null && !slots) slots = [body.slot];
    if (!Array.isArray(slots) || slots.length === 0) {
      return reply.code(400).send({
        status: "error",
        error: "slot_required",
        hint: "ровно один слот: { slot: 1 } или { slots: [1] }",
      });
    }
    if (slots.length !== 1) {
      return reply.code(400).send({
        status: "error",
        error: "one_slot_only",
        hint: "из настроек CRM — только по одной шутке; пачка — у ночного cron",
      });
    }

    const result = await previewHighlightSlots(date, slots);
    const code =
      result.status === "error" ? 500 : result.status === "disabled" ? 503 : result.status === "already_running" ? 409 : 200;
    console.log(
      `[home-highlights] preview CRM (${user.email || user.id}) → ${result.status}`
    );
    return reply.code(code).send(result);
  });

  fastify.post("/api/daily-highlights/commit", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const body = request.body || {};
    const previewId = body.id || body.preview_id || body.items?.[0]?.id;
    if (!previewId) {
      return reply.code(400).send({
        status: "error",
        error: "id_required",
        hint: "{ id: \"<preview uuid>\" }",
      });
    }

    try {
      const result = await commitHighlightBatch(null, [{ id: previewId }]);
      const code = result.status === "ok" ? 200 : 400;
      console.log(
        `[home-highlights] commit CRM (${user.email || user.id}) → ${result.status} id=${previewId}`
      );
      return reply.code(code).send(result);
    } catch (e) {
      return reply.code(500).send({ status: "error", message: e.message });
    }
  });

  fastify.post("/api/daily-highlights/discard", async (request, reply) => {
    const user = await assertSuperAdminFromRequest(request, reply);
    if (!user) return;

    const body = request.body || {};
    const previewId = body.id || body.preview_id;
    if (!previewId) {
      return reply.code(400).send({
        status: "error",
        error: "id_required",
        hint: "{ id: \"<preview uuid>\" }",
      });
    }

    try {
      const result = await discardPreview(previewId);
      const code = result.status === "ok" ? 200 : 400;
      console.log(
        `[home-highlights] discard CRM (${user.email || user.id}) → ${result.status} id=${previewId}`
      );
      return reply.code(code).send(result);
    } catch (e) {
      return reply.code(500).send({ status: "error", message: e.message });
    }
  });
}

module.exports = { registerHomeHighlightsRoutes };
