/** Env + defaults for montage queue PDF send. */

const CONTRACT_SCAN_BUCKET = "contract-scans";
const CAPTION_MAX = 1024;

const CHAT_ID =
  process.env.INSTALLATION_QUEUE_CHAT_ID || "-1002283388310";

const THREAD_ID_RAW = process.env.INSTALLATION_QUEUE_THREAD_ID || "24785";
const THREAD_ID = (() => {
  const n = Number(THREAD_ID_RAW);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

module.exports = {
  CONTRACT_SCAN_BUCKET,
  CAPTION_MAX,
  CHAT_ID,
  THREAD_ID,
};
