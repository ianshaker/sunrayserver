const fs = require("fs");
const { TOKEN_PATH, CACHE_PATH } = require("../config");

function readToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

function writeToken(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

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
