// ============================================================================
// mango-calls — админ API: чистка строк без файла + ручной запрос AI.
// ============================================================================

const DELETE_PATH = "/api/mango-calls/delete";
const REQUEST_AI_PATH = "/api/mango-calls/request-ai";
const CALL_RECORDINGS_BUCKET = "call-recordings";
const MAX_IDS_PER_REQUEST = 200;

module.exports = {
  DELETE_PATH,
  REQUEST_AI_PATH,
  CALL_RECORDINGS_BUCKET,
  MAX_IDS_PER_REQUEST,
};
