// Настройки Q&A по истории звонков (CRM «Задать вопрос»).
module.exports = {
  MAX_CALLS: parseInt(process.env.CALL_ASK_MAX_CALLS || "20", 10),
  MAX_CALLS_HARD: 30,
};
