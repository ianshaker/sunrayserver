const { Readable } = require("stream");
const { CHAT_ID, THREAD_ID } = require("./config");
const { formatInstallationCaption, safeFilename } = require("./caption");
const { downloadContractScan } = require("./storage");

/**
 * Download PDF from Supabase and sendDocument + HTML caption to montage chat.
 * @returns {{ messageId: number|null }}
 */
async function sendInstallationQueueDocument(telegramBot, payload) {
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

  if (!telegramBot) {
    throw new Error("Telegram bot не инициализирован");
  }
  if (!CHAT_ID) {
    throw new Error("INSTALLATION_QUEUE_CHAT_ID не задан");
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
  const stream = Readable.from(pdfBuffer);

  const options = {
    caption,
    parse_mode: "HTML",
    disable_notification: false,
  };
  if (THREAD_ID) {
    options.message_thread_id = THREAD_ID;
  }

  const sent = await telegramBot.sendDocument(CHAT_ID, stream, options, {
    filename,
    contentType: "application/pdf",
  });

  console.log(
    `[installation-queue] ✅ sent message_id=${sent?.message_id ?? "—"}`,
  );

  return { messageId: sent?.message_id ?? null };
}

module.exports = {
  sendInstallationQueueDocument,
};
