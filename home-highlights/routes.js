// ============================================================================
// HTTP: ручная генерация / статус фактов дня.
//   POST /api/daily-highlights/generate?key=...
//   GET  /api/daily-highlights/status?key=...
// ============================================================================

const { supabase } = require("../lib/supabaseClient");
const { SETUP_SECRET } = require("./config");
const {
  generateDailyHighlights,
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
      .select("highlight_date, slot, status, text, bot_comment, source_entry_id, created_at")
      .eq("highlight_date", yesterday)
      .order("slot", { ascending: true });

    if (error) {
      return reply.code(500).send({ status: "error", message: error.message });
    }
    return reply.send({
      status: "ok",
      highlight_date: yesterday,
      today_msk: mskDateString(),
      rows: data || [],
    });
  });
}

module.exports = { registerHomeHighlightsRoutes };
