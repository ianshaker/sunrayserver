// ============================================================================
// mango-calls — админ-чистка строк без файла записи (CRM Settings).
// ============================================================================

const DELETE_PATH = "/api/mango-calls/delete";
const CALL_RECORDINGS_BUCKET = "call-recordings";
const MAX_IDS_PER_REQUEST = 200;

module.exports = {
  DELETE_PATH,
  CALL_RECORDINGS_BUCKET,
  MAX_IDS_PER_REQUEST,
};
