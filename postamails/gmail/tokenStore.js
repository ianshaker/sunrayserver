const fs = require("fs");
const { TOKEN_PATH, CACHE_PATH } = require("../config");
const { supabase } = require("../supabaseClient");

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
  try {
    const { data, error } = await supabase
      .from("gmail_oauth_tokens")
      .select("token")
      .eq("id", TOKEN_ROW_ID)
      .maybeSingle();
    if (error) {
      console.error("[postamails] ❌ чтение токена из Supabase:", error.message);
      return null;
    }
    return data?.token || null;
  } catch (e) {
    console.error("[postamails] ❌ чтение токена из Supabase:", e.message);
    return null;
  }
}

async function writeTokenToSupabase(tokens) {
  try {
    const { error } = await supabase.from("gmail_oauth_tokens").upsert({
      id: TOKEN_ROW_ID,
      token: tokens,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(
        "[postamails] ❌ запись токена в Supabase:",
        error.message,
        "(применена ли миграция gmail_oauth_tokens + anon-политики?)",
      );
      return false;
    }
    console.log("[postamails] ✅ токен Gmail сохранён в Supabase.");
    return true;
  } catch (e) {
    console.error("[postamails] ❌ запись токена в Supabase:", e.message);
    return false;
  }
}

async function readToken() {
  const remote = await readTokenFromSupabase();
  if (remote) return remote;
  return readTokenFromDisk();
}

async function writeToken(tokens) {
  const savedToDb = await writeTokenToSupabase(tokens);
  writeTokenToDisk(tokens);
  return savedToDb;
}

// Проверка: реально ли токен лежит в постоянном хранилище (Supabase), а не только in-memory/диск.
async function isTokenPersistedInSupabase() {
  const remote = await readTokenFromSupabase();
  return Boolean(remote);
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
  isTokenPersistedInSupabase,
  readCache,
  writeCache,
  ensureCacheFile,
};
