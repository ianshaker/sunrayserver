// ============================================================================
// Gemini для home-highlights.
// Google SA берём из call-ai/googleAuth — только общий auth (тот же env),
// без pipeline STT/саммари и без остальной логики call-ai.
// ============================================================================

const { hasCredentials, getCredentials, getAuthClient } = require("../call-ai/googleAuth");
const { VERTEX_LOCATION, MODEL } = require("./config");
const { HIGHLIGHT_SYSTEM_PROMPT } = require("./prompts");

function buildGeminiUrl(projectId, location, model) {
  const path =
    `/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  if (location === "global") {
    return `https://aiplatform.googleapis.com${path}`;
  }
  return `https://${location}-aiplatform.googleapis.com${path}`;
}

function extractText(resp) {
  const cand = resp.data?.candidates?.[0];
  return (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

function stripWrappingQuotes(raw) {
  let t = (raw || "").trim();
  if (!t) return "";
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("«") && t.endsWith("»"))
  ) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Только явный обрыв («Саша,…»). Лимит длины сервер НЕ режет —
 * в промпте мягкая подсказка боту, в БД пишем как пришло.
 */
function looksIncomplete(t) {
  if (!t) return true;
  if (/…\s*$/.test(t) || /\.\.\.\s*$/.test(t)) return true;
  if (/[,;:—–]\s*$/.test(t)) return true;
  return false;
}

function cleanField(raw) {
  const t = stripWrappingQuotes(raw);
  if (!t) return null;
  return looksIncomplete(t) ? null : t;
}

/**
 * @returns {{ situation: string, bot_comment: string|null } | null}
 */
function parseHighlightResponse(raw) {
  let t = (raw || "").trim();
  if (!t) return null;
  if (/^SKIP\b/i.test(t)) return null;

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();

  const jsonMatch = t.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj && (obj.skip === true || obj.SKIP === true)) return null;
      const situation = cleanField(obj.situation || obj.text || "");
      if (!situation) return null;
      const botComment = cleanField(
        obj.bot_comment || obj.comment || obj.aside || ""
      );
      return { situation, bot_comment: botComment || null };
    } catch (_) {
      /* fall through */
    }
  }

  const situation = cleanField(t);
  return situation ? { situation, bot_comment: null } : null;
}

async function generateHighlightFromTranscript(transcript) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;
  const url = buildGeminiUrl(projectId, VERTEX_LOCATION, MODEL);

  const body = {
    systemInstruction: { parts: [{ text: HIGHLIGHT_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{ text: `Расшифровка разговора:\n\n${transcript || ""}` }],
      },
    ],
    generationConfig: {
      temperature: 0.75,
      maxOutputTokens: 512,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
    },
  };

  const resp = await client.request({ url, method: "POST", data: body, timeout: 60000 });
  return parseHighlightResponse(extractText(resp));
}

module.exports = {
  hasCredentials,
  generateHighlightFromTranscript,
  parseHighlightResponse,
};
