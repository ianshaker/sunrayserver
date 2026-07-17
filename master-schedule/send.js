/**
 * sendPhoto: JPEG графика мастера в личный чат.
 * multipart без пакета form-data (как installation-queue).
 */

const https = require("https");
const { TELEGRAM_TOKEN } = require("../tgwebhook/config");

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
 * @param {{ chatId: number, caption: string, jpegBuffer: Buffer }}
 * @returns {Promise<{ messageId: number|null }>}
 */
async function sendMasterSchedulePhoto({ chatId, caption, jpegBuffer }) {
  if (!chatId) throw new Error("chat_id не задан");
  if (!jpegBuffer || !Buffer.isBuffer(jpegBuffer) || jpegBuffer.length === 0) {
    throw new Error("Пустой JPEG");
  }

  const parts = [
    { kind: "field", name: "chat_id", value: String(chatId) },
    { kind: "field", name: "caption", value: caption || "" },
    {
      kind: "file",
      name: "photo",
      filename: "schedule.jpg",
      contentType: "image/jpeg",
      buffer: jpegBuffer,
    },
  ];

  const { boundary, body } = buildMultipart(parts);
  const result = await postTelegram("sendPhoto", body, boundary);
  return { messageId: result?.message_id ?? null };
}

module.exports = {
  sendMasterSchedulePhoto,
};
