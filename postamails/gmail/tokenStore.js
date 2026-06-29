const fs = require("fs");
const { TOKEN_PATH, CACHE_PATH } = require("../config");
const { supabase, HAS_SERVICE_ROLE } = require("../supabaseClient");

const TOKEN_ROW_ID = "sunray";

// ---- Диск (фолбэк / локальная разработка) ----
function readTokenFromDisk() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  } catch (e) {
    console.error("[postamails] не удалось прочитать токен с диска:", e.message);
    return null;
  }
}

function writeTokenToDisk(tokens) {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  } catch (e) {
    console.error("[postamails] не удалось записать токен на диск:", e.message);
  }
}

// ---- Supabase (основной источник: общий для всех инстансов, переживает redeploy) ----
async function readTokenFromSupabase() {
  if (!HAS_SERVICE_ROLE) return null;
  try {
    const { data, error } = await supabase
      .from("gmail_oauth_tokens")
      .select("token")
      .eq("id", TOKEN_ROW_ID)
      .maybeSingle();
    if (error) {
      console.error("[postamails] чтение токена из Supabase:", error.message);
      return null;
    }
    return data?.token || null;
  } catch (e) {
    console.error("[postamails] чтение токена из Supabase:", e.message);
    return null;
  }
}

async function writeTokenToSupabase(tokens) {
  if (!HAS_SERVICE_ROLE) return;
  try {
    const { error } = await supabase.from("gmail_oauth_tokens").upsert({
      id: TOKEN_ROW_ID,
      token: tokens,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[postamails] запись токена в Supabase:", error.message);
    }
  } catch (e) {
    console.error("[postamails] запись токена в Supabase:", e.message);
  }
}

async function readToken() {
  const remote = await readTokenFromSupabase();
  if (remote) return remote;
  return readTokenFromDisk();
}

async function writeToken(tokens) {
  await writeTokenToSupabase(tokens);
  writeTokenToDisk(tokens);
}

// ---- Кэш обработанных писем (на диске, дедуп всё равно по телефону) ----
function ensureCacheFile() {
  if (!fs.existsSync(CACHE_PATH)) {
    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify({ date: "", emailIds: [] }, null, 2),
    );
  }
}

function readCache() {
  ensureCacheFile();
  return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
}

function writeCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

module.exports = {
  readToken,
  writeToken,
  readCache,
  writeCache,
  ensureCacheFile,
};
