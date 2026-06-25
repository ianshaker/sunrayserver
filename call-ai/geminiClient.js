// Общий клиент Vertex AI Gemini (generateContent).
const { getCredentials, getAuthClient } = require("./googleAuth");

function buildGeminiUrl(projectId, location, model) {
  const path =
    `/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  if (location === "global") {
    return `https://aiplatform.googleapis.com${path}`;
  }
  return `https://${location}-aiplatform.googleapis.com${path}`;
}

async function generateContent({ systemPrompt, userPrompt, model, location, generationConfig = {} }) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;
  const url = buildGeminiUrl(projectId, location, model);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      topP: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
      ...generationConfig,
    },
  };

  const resp = await client.request({ url, method: "POST", data: body, timeout: 60000 });
  const cand = resp.data?.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text || "").join("").trim() || "";
  return { text, finishReason: cand?.finishReason || null, usage: resp.data?.usageMetadata || {} };
}

module.exports = { buildGeminiUrl, generateContent };
