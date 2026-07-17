/**
 * sendDocument через multipart без пакета form-data
 * (на Render nested form-data из node-telegram-bot-api не резолвится).
 */

const https = require("https");
const { TELEGRAM_TOKEN } = require("../tgwebhook/config");
const { CHAT_ID, THREAD_ID } = require("./config");
const { formatInstallationCaption, safeFilename } = require("./caption");
const { downloadContractScan } = require("./storage");

function buildMultipartBody(fields, file) {
  const boundary = `----SunrayBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`,
      ),
    );
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

function postSendDocument(body, boundary) {
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
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
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
    req.write(body);
    req.end();
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
  const fields = {
    chat_id: String(CHAT_ID),
    caption,
    parse_mode: "HTML",
    disable_notification: "false",
  };
  if (THREAD_ID) {
    fields.message_thread_id = String(THREAD_ID);
  }

  const { boundary, body } = buildMultipartBody(fields, {
    fieldName: "document",
    filename,
    contentType: "application/pdf",
    buffer: pdfBuffer,
  });

  const sent = await postSendDocument(body, boundary);

  console.log(
    `[installation-queue] ✅ sent message_id=${sent?.message_id ?? "—"}`,
  );

  return { messageId: sent?.message_id ?? null };
}

module.exports = {
  sendInstallationQueueDocument,
};
