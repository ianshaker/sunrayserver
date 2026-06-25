// ============================================================================
// Google Cloud Storage для STT.
//
// Google Speech-to-Text не принимает inline-аудио длиннее 60 сек — нужен gs:// URI.
// Поэтому перед распознаванием mp3 заливаем во временный GCS-бакет того же проекта,
// после распознавания удаляем. Авторизация — тот же сервис-аккаунт (Editor).
// Работаем через REST (gaxios), без @google-cloud/storage.
// ============================================================================

const { getCredentials, getAuthClient } = require("./googleAuth");

const GCS_API = "https://storage.googleapis.com/storage/v1";
const GCS_UPLOAD_API = "https://storage.googleapis.com/upload/storage/v1";

// Имя бакета: env GCS_STT_BUCKET или производное от project_id (глобально уникально).
function getBucketName() {
  if (process.env.GCS_STT_BUCKET) return process.env.GCS_STT_BUCKET;
  const projectId = getCredentials().project_id;
  return `${projectId}-stt-temp`;
}

function getBucketLocation() {
  return process.env.GCS_STT_LOCATION || "US";
}

// Бакет существует? Если нет — создаём.
async function ensureBucket(bucket) {
  const client = await getAuthClient();
  const projectId = getCredentials().project_id;

  const check = await client.request({
    url: `${GCS_API}/b/${encodeURIComponent(bucket)}`,
    method: "GET",
    validateStatus: (s) => s === 200 || s === 404 || s === 403,
  });
  if (check.status === 200) return;

  const createResp = await client.request({
    url: `${GCS_API}/b?project=${encodeURIComponent(projectId)}`,
    method: "POST",
    data: {
      name: bucket,
      location: getBucketLocation(),
      storageClass: "STANDARD",
      // Автоудаление объектов через 1 день — на случай, если ручное удаление не прошло.
      lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 1 } }] },
    },
    validateStatus: (s) => s === 200 || s === 409, // 409 = уже создан (гонка)
  });

  if (createResp.status !== 200 && createResp.status !== 409) {
    throw new Error(`GCS bucket create failed: ${createResp.status}`);
  }
}

// Заливаем буфер. Возвращает gs:// URI.
async function uploadObject(bucket, objectName, buffer, contentType = "audio/mpeg") {
  const client = await getAuthClient();
  const url =
    `${GCS_UPLOAD_API}/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(objectName)}`;

  const resp = await client.request({
    url,
    method: "POST",
    headers: { "Content-Type": contentType },
    data: buffer,
    validateStatus: (s) => s < 400,
  });

  if (resp.status >= 400) {
    throw new Error(`GCS upload failed: ${resp.status}`);
  }
  return `gs://${bucket}/${objectName}`;
}

async function deleteObject(bucket, objectName) {
  try {
    const client = await getAuthClient();
    await client.request({
      url: `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`,
      method: "DELETE",
      validateStatus: (s) => s === 204 || s === 404,
    });
  } catch (e) {
    console.warn(`⚠️ GCS delete не удалось (${objectName}): ${e.message}`);
  }
}

module.exports = { getBucketName, ensureBucket, uploadObject, deleteObject };
