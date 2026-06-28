const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

module.exports = {
  TELEGRAM_CHAT_ID: -1002582438853,

  SCOPES: ["https://www.googleapis.com/auth/gmail.readonly"],
  GMAIL_LABEL_QUERY: 'label:"Заявки Sunray"',

  DATA_DIR,
  TOKEN_PATH: path.join(DATA_DIR, "gmail-token.json"),
  CREDENTIALS_PATH: path.join(DATA_DIR, "gmail-credentials.json"),
  CACHE_PATH: path.join(DATA_DIR, "postamailsCache.json"),
  CONTRACTS_PATH: path.join(ROOT_DIR, "contractsfinalnew.json"),

  TABLES_TO_CHECK: [
    "appeals",
    "appealsotkaz",
    "dobivashki",
    "dogovornew",
    "eventsnew",
    "zamerotkaz",
  ],

  PRODUCT_KEYWORDS: [
    "Рулонные шторы",
    "Римские шторы",
    "Жалюзи",
    "Москитные сетки",
  ],

  /** Cron: каждую минуту, круглосуточно. */
  CRON_PATTERN: "0 * * * * *",

  TOKEN_ERROR_INTERVAL_MS: 2 * 60 * 60 * 1000,

  /** Задержка TG-алерта после listen — Render успевает поднять HTTP. */
  TOKEN_ALERT_DELAY_MS: 8000,

  PUBLIC_BASE_URL:
    process.env.PUBLIC_BASE_URL || "https://sunrayserver.onrender.com",
  SETUP_PATH: "/gmail/setup",
  START_PATH: "/gmail/start",
  EXCHANGE_PATH: "/gmail/exchange-code",

  /** Секрет в URL (?key=). Задай GMAIL_SETUP_SECRET на Render. */
  GMAIL_SETUP_SECRET: process.env.GMAIL_SETUP_SECRET || "",
};
