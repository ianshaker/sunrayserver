const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

module.exports = {
  TELEGRAM_CHAT_ID: -1002582438853,

  /** Источник заявки в CRM. Им же ищутся вчерашние заявки при разборе признаков рассылки. */
  APPEAL_SOURCE: "Почта",

  SCOPES: ["https://www.googleapis.com/auth/gmail.readonly"],
  GMAIL_LABEL_QUERY: 'label:"Заявки Sunray"',

  DATA_DIR,
  TOKEN_PATH: path.join(DATA_DIR, "gmail-token.json"),
  CREDENTIALS_PATH: path.join(DATA_DIR, "gmail-credentials.json"),
  CONTRACTS_PATH: path.join(ROOT_DIR, "contractsfinalnew.json"),

  TABLES_TO_CHECK: [
    "appeals",
    "appealsotkaz",
    "dobivashki",
    "dogovornew",
    "eventsnew",
    "zamerotkaz",
  ],

  /**
   * Как называть таблицу в сообщении менеджеру: в CRM он видит разделы, а не
   * имена таблиц, и «appealsotkaz» ему ничего не говорит. Ключи держать теми
   * же, что в TABLES_TO_CHECK: разъедутся — в чат вернётся английское имя.
   */
  TABLE_LABELS: {
    appeals: "Обращения",
    appealsotkaz: "Отказы входящих",
    dobivashki: "Добивашки",
    dogovornew: "Сделки, действующий договор",
    eventsnew: "События",
    zamerotkaz: "Отказы замеров",
  },

  /**
   * По этим словам робот узнаёт продукт в письме с сайта. Значения обязаны совпадать со
   * справочником CRM (`sunray-crm-oasis/src/constants/appealOptions.ts`): что робот запишет,
   * то менеджер и увидит в выпадашке.
   *
   * Виды жалюзи и день-ночь добавлены 22.09.2026 вместе с той же правкой в CRM. Важно: выбирается
   * самое длинное совпадение (см. matchProductKeyword), иначе «Деревянные жалюзи» с формы
   * схлопнулись бы обратно в «Жалюзи».
   */
  PRODUCT_KEYWORDS: [
    "Шторы",
    "Москитные сетки",
    "Рулонные шторы",
    "Жалюзи",
    "Римские шторы",
    "Плиссе",
    "Горизонтальные жалюзи",
    "Вертикальные жалюзи",
    "Деревянные жалюзи",
    "Рулонные день-ночь",
    "Тонировка перегородок",
  ],

  /** Cron: каждую минуту, круглосуточно. */
  CRON_PATTERN: "0 * * * * *",

  /** Лог «тишины» раз в N успешных проверок без новых писем. */
  EMAIL_QUIET_LOG_EVERY: 30,

  /** Суточная сводка: 06:00 МСК (03:00 UTC) — до начала рабочего дня. */
  DIGEST_CRON_PATTERN: "0 0 3 * * *",

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
