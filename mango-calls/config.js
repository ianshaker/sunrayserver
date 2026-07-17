// ============================================================================
// mango-calls — админ API: чистка строк без файла + ручной запрос AI.
// ============================================================================

const DELETE_PATH = "/api/mango-calls/delete";
const REQUEST_AI_PATH = "/api/mango-calls/request-ai";
const CALL_RECORDINGS_BUCKET = "call-recordings";
const MAX_IDS_PER_REQUEST = 200;
/** Мин. длительность разговора для ручного AI (исходящие из CRM). */
const MIN_TALK_SECONDS_FOR_AI = 30;

module.exports = {
  DELETE_PATH,
  REQUEST_AI_PATH,
  CALL_RECORDINGS_BUCKET,
  MAX_IDS_PER_REQUEST,
  MIN_TALK_SECONDS_FOR_AI,
};
