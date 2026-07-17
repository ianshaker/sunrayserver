/**
 * sendDocument через multipart FormData.
 * node-telegram-bot-api кладёт длинный caption в query string → EPARSE / 500.
 */

const https = require("https");
const FormData = require("form-data");
const { TELEGRAM_TOKEN } = require("../tgwebhook/config");
const { CHAT_ID, THREAD_ID } = require("./config");
const { formatInstallationCaption, safeFilename } = require("./caption");
const { downloadContractScan } = require("./storage");

function postSendDocument(form) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN) {
      reject(new Error("TELEGRAM_TOKEN не задан"));
      return;
    }

    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_TOKEN}/sendDocument`,
        method: "POST",
        headers: form.getHeaders(),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            reject(
              new Error(
                `Telegram non-JSON (${res.statusCode}): ${raw.slice(0, 240)}`,
              ),
            );
            return;
          }
          if (!json.ok) {
            const err = new Error(
              json.description || `Telegram error ${res.statusCode}`,
            );
            err.telegramErrorCode = json.error_code;
            reject(err);
            return;
          }
          resolve(json.result);
        });
      },
    );

    req.on("error", reject);
    form.pipe(req);
  });
}

/**
 * Download PDF from Supabase and sendDocument + HTML caption to montage chat.
 * @returns {{ messageId: number|null }}
 */
async function sendInstallationQueueDocument(_telegramBot, payload) {
  const {
    dogovorNumber,
    appealNumber,
    city,
    phone,
    installationSum,
    factorySummary,
    queueStatus,
    documents,
    comments,
    contractScanPath,
  } = payload;

  if (!CHAT_ID) {
    throw new Error("INSTALLATION_QUEUE_CHAT_ID не задан");
  }
  if (!TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN не задан");
  }

  const scanPath =
    typeof contractScanPath === "string" ? contractScanPath.trim() : "";
  if (!scanPath) {
    throw new Error("Отсутствует contractScanPath");
  }

  console.log(
    `[installation-queue] dogovor=${dogovorNumber} path=${scanPath} chat=${CHAT_ID}` +
      (THREAD_ID ? ` thread=${THREAD_ID}` : ""),
  );

  const pdfBuffer = await downloadContractScan(scanPath);
  if (!pdfBuffer.length) {
    const err = new Error("PDF скана пустой или не найден");
    err.statusCode = 404;
    throw err;
  }

  const caption = formatInstallationCaption({
    dogovorNumber,
    appealNumber,
    city,
    phone,
    installationSum,
    factorySummary,
    queueStatus,
    documents,
    comments,
  });

  const filename = safeFilename(dogovorNumber);

  const form = new FormData();
  form.append("chat_id", String(CHAT_ID));
  form.append("caption", caption);
  form.append("parse_mode", "HTML");
  form.append("disable_notification", "false");
  if (THREAD_ID) {
    form.append("message_thread_id", String(THREAD_ID));
  }
  form.append("document", pdfBuffer, {
    filename,
    contentType: "application/pdf",
  });

  const sent = await postSendDocument(form);

  console.log(
    `[installation-queue] ✅ sent message_id=${sent?.message_id ?? "—"}`,
  );

  return { messageId: sent?.message_id ?? null };
}

module.exports = {
  sendInstallationQueueDocument,
};
