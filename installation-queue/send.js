/**
 * Отправка в монтажный чат: альбом JPEG (caption на первом фото).
 * multipart без пакета form-data.
 */

const https = require("https");
const { TELEGRAM_TOKEN } = require("../tgwebhook/config");
const { CHAT_ID, THREAD_ID } = require("./config");
const { formatInstallationCaption } = require("./caption");
const { downloadContractScanPages } = require("./storage");

function buildMultipart(parts) {
  const boundary = `----SunrayBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks = [];

  for (const part of parts) {
    if (part.kind === "field") {
      if (part.value == null || part.value === "") continue;
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${part.name}"\r\n\r\n` +
            `${part.value}\r\n`,
        ),
      );
      continue;
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
          `Content-Type: ${part.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(part.buffer);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return { boundary, body: Buffer.concat(chunks) };
}

function postTelegram(method, body, boundary) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN) {
      reject(new Error("TELEGRAM_TOKEN не задан"));
      return;
    }

    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_TOKEN}/${method}`,
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
 * @param {{ caption: string, pages: Array<{ role: string, order: number, buffer: Buffer }> }}
 */
async function sendAsPhotoAlbum({ caption, pages }) {
  const media = pages.map((page, i) => {
    const item = {
      type: "photo",
      media: `attach://photo${i}`,
    };
    if (i === 0) {
      item.caption = caption;
      item.parse_mode = "HTML";
    }
    return item;
  });

  const parts = [
    { kind: "field", name: "chat_id", value: String(CHAT_ID) },
    { kind: "field", name: "media", value: JSON.stringify(media) },
    { kind: "field", name: "disable_notification", value: "false" },
  ];
  if (THREAD_ID) {
    parts.push({
      kind: "field",
      name: "message_thread_id",
      value: String(THREAD_ID),
    });
  }

  for (let i = 0; i < pages.length; i++) {
    const role = pages[i].role || `page${i}`;
    parts.push({
      kind: "file",
      name: `photo${i}`,
      filename: `${role}.jpg`,
      contentType: "image/jpeg",
      buffer: pages[i].buffer,
    });
  }

  const { boundary, body } = buildMultipart(parts);
  const result = await postTelegram("sendMediaGroup", body, boundary);
  const first = Array.isArray(result) ? result[0] : null;
  return { messageId: first?.message_id ?? null, mode: "album" };
}

/**
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
    contractScanPages,
  } = payload;

  if (!CHAT_ID) {
    throw new Error("INSTALLATION_QUEUE_CHAT_ID не задан");
  }
  if (!TELEGRAM_TOKEN) {
    throw new Error("TELEGRAM_TOKEN не задан");
  }

  if (!Array.isArray(contractScanPages) || contractScanPages.length === 0) {
    throw new Error("Отсутствует contractScanPages");
  }

  console.log(
    `[installation-queue] dogovor=${dogovorNumber} pages=${contractScanPages.length} chat=${CHAT_ID}` +
      (THREAD_ID ? ` thread=${THREAD_ID}` : ""),
  );

  const pages = await downloadContractScanPages(contractScanPages);

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

  console.log(
    `[installation-queue] caption[0..120]=${JSON.stringify(caption.slice(0, 120))}`,
  );

  const result = await sendAsPhotoAlbum({ caption, pages });

  console.log(
    `[installation-queue] ✅ mode=${result.mode} message_id=${result.messageId ?? "—"}`,
  );

  return { messageId: result.messageId };
}

module.exports = {
  sendInstallationQueueDocument,
};
