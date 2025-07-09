const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const schedule = require("node-schedule");

const TELEGRAM_CHAT_ID = -1002582438853;

// -- Бот подключается через server.js и передаётся сюда (см. внизу export)
let TELEGRAM_BOT = null;

// Supabase setup
const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES_TO_CHECK = [
  "appeals", "appealsotkaz", "dobivashki",
  "dogovornew", "eventsnew", "zamerotkaz"
];

const PRODUCT_KEYWORDS = [
  "Рулонные шторы", "Римские шторы", "Жалюзи", "Москитные сетки"
];

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_PATH = path.join(__dirname, "data", "gmail-token.json");
const CREDENTIALS_PATH = path.join(__dirname, "data", "gmail-credentials.json");
const CACHE_PATH = path.join(__dirname, "data", "postamailsCache.json");

let gmailClient = null;
let oAuth2Client = null;

// ---- Gmail API ----
async function initGmailClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error("Gmail credentials file not found.");
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  if (!fs.existsSync(TOKEN_PATH)) throw new Error("No Gmail token found. Please authorize first.");
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  oAuth2Client.setCredentials(token);
  gmailClient = google.gmail({ version: "v1", auth: oAuth2Client });
  if (!fs.existsSync(CACHE_PATH)) fs.writeFileSync(CACHE_PATH, JSON.stringify({ date: '', emailIds: [] }, null, 2));
  console.log("Gmail API client initialized.");
}

// ---- Универсальная функция для формата телефона ----
function formatPhoneClassic(digits) {
  // digits: только цифры, 10 или 11 знаков
  if (!digits) return "";
  // если +7 или 8, убираем первую цифру
  digits = digits.replace(/^(\+7|7|8)/, "");
  if (digits.length !== 10) return digits; // fallback на случай сбоя
  return `8(${digits.substring(0, 3)})${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
}

// ---- Извлечение номера из текста, перевод к формату базы ----
function extractPhone(text) {
  const match = text.match(/\+7\s*\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  // Приводим к виду "8(915)141-87-21"
  return formatPhoneClassic(digits);
}

// ---- Нормализация: всегда формат как в базе! ----
function normalizePhone(phone) {
  if (!phone) return null;
  // Оставить только цифры, далее привести к нужному формату
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    // если начинается с 7 или 8, убрать первую цифру
    return formatPhoneClassic(digits);
  }
  if (digits.length === 10) {
    return formatPhoneClassic('8' + digits); // добавить ведущую 8
  }
  return phone;
}

function extractName(text) {
  const match = text.match(/Имя:\s*(.+)/i) || text.match(/Ваше имя:\s*(.+)/i);
  return match ? match[1].trim() : "";
}

function extractCity(text) {
  const match = text.match(/Город:\s*(.+)/i);
  return match ? match[1].trim() : "Без города";
}

function extractProduct(text) {
  const found = PRODUCT_KEYWORDS.find(p => text.includes(p));
  return found || "Продукт не указан";
}

// ---- Поиск по завершенным договорам (локальный файл) ----
function findContractByPhoneFromFile(phone) {
  try {
    const filePath = path.join(__dirname, "contractsfinalnew.json");
    if (!fs.existsSync(filePath)) return null;
    const contracts = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const clearPhone = phone.replace(/\D/g, '');
    return contracts.find(contract => {
      const contractPhone = (contract.phone || '').replace(/\D/g, '');
      return contractPhone && contractPhone === clearPhone;
    }) || null;
  } catch (e) {
    return null;
  }
}

// ---- Работа с Supabase ----
async function getFreeAppealId() {
  console.log("[getFreeAppealId] — Ищу свободный appeal_id...");
  const { data, error } = await supabase
    .from("ids")
    .select("id, appeal_id, is_used, used_at")
    .eq("is_used", false)
    .is("used_at", null)
    .order("id", { ascending: true })
    .limit(10);
  if (error) console.error("[getFreeAppealId] Ошибка запроса:", error);
  if (!data || data.length === 0) {
    console.warn("[getFreeAppealId] Нет свободных ID! DATA:", data);
    throw new Error("Нет свободных ID");
  }
  console.log("[getFreeAppealId] Найдено свободных:", data.length, "Первый:", data[0]);
  return data[0].appeal_id;
}

async function markAppealIdUsed(appeal_id) {
  const used_at = new Date().toISOString();
  console.log(`[markAppealIdUsed] Отмечаю appeal_id ${appeal_id} как is_used=true, used_at=${used_at}`);
  const { error } = await supabase.from("ids").update({ is_used: true, used_at }).eq("appeal_id", appeal_id);
  if (error) {
    console.error(`[markAppealIdUsed] Ошибка при обновлении appeal_id ${appeal_id}:`, error);
  } else {
    console.log(`[markAppealIdUsed] appeal_id ${appeal_id} успешно обновлен.`);
  }
}

async function phoneExistsInAnyTable(normalizedPhone) {
  console.log(`[phoneExistsInAnyTable] Проверяю наличие телефона ${normalizedPhone} в таблицах...`);
  for (const table of TABLES_TO_CHECK) {
    const { data, error } = await supabase
      .from(table)
      .select("phone")
      .limit(1)
      .eq("phone", normalizedPhone);
    if (error) {
      console.error(`[phoneExistsInAnyTable] Ошибка запроса к таблице ${table}:`, error);
      continue;
    }
    if (data && data.length > 0) {
      console.log(`[phoneExistsInAnyTable] Найден дубликат в таблице ${table}:`, data[0]);
      return true;
    }
  }
  console.log(`[phoneExistsInAnyTable] Телефон ${normalizedPhone} не найден в указанных таблицах.`);
  return false;
}

// ---- Вставка заявки ----
async function insertAppealFromEmail(emailText) {
  const phone = extractPhone(emailText);
  if (!phone) throw new Error("Телефон не найден");
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Невалидный номер");

  // === Поиск в локальном файле завершённых договоров ===
  const contract = findContractByPhoneFromFile(normalizedPhone);
  if (contract) {
    if (TELEGRAM_BOT) {
      await TELEGRAM_BOT.sendMessage(
        TELEGRAM_CHAT_ID,
        `⛔️ <b>Клиент найден в завершённых договорах</b>\nНомер: <b>${contract.appeal_id || ''}</b>\nКлиент: <b>${contract.client_name || ''}</b>\nТелефон: <b>${contract.phone || ''}</b>\nГород: <b>${contract.city || ''}</b>\nНомер договора: <b>${contract.dogovor_number || ''}</b>`,
        { parse_mode: "HTML" }
      );
    }
    return "Клиент найден в завершённых договорах";
  }

  const isDuplicate = await phoneExistsInAnyTable(normalizedPhone);
  if (isDuplicate) return "Уже есть такая заявка";
  const name = extractName(emailText);
  const city = extractCity(emailText);
  const product_type = extractProduct(emailText);
  const appeal_id = await getFreeAppealId();
  await markAppealIdUsed(appeal_id);

  const appeal = {
    appeal_number: appeal_id,
    client_name: name,
    phone: normalizedPhone, // только формат 8(XXX)XXX-XX-XX
    city,
    source: "Почта",
    manager: "Ян",
    dialog: emailText,
    product_type,
    status: "Активно",
    address: "",
    detailed_address: "",
    reminder_date: null,
    reminder_time: null,
    task_description: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from("appeals").insert([appeal]);
  if (insertError) throw insertError;

  if (TELEGRAM_BOT) {
    await TELEGRAM_BOT.sendMessage(
      TELEGRAM_CHAT_ID,
      `📨 <b>НОВАЯ ЗАЯВКА С ПОЧТЫ</b>\nНомер: <b>${appeal_id}</b>\nКлиент: <b>${name}</b>\nТелефон: <b>${normalizedPhone}</b>\nГород: <b>${city}</b>\nПродукт: <b>${product_type}</b>`,
      { parse_mode: "HTML" }
    );
  }
  return "Заявка создана";
}

// ---- Проверка новых писем ----
async function checkNewEmails() {
  try {
    const today = new Date();
    const formattedDate = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
    let cache = { date: '', emailIds: [] };
    if (fs.existsSync(CACHE_PATH)) cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    if (cache.date !== formattedDate) {
      cache = { date: formattedDate, emailIds: [] };
    }
    const res = await gmailClient.users.messages.list({
      userId: 'me',
      q: `label:"Заявки Sunray" after:${formattedDate}`,
      maxResults: 20
    });
    const ids = (res.data.messages || []).map(m => m.id);
    const newIds = ids.filter(id => !cache.emailIds.includes(id));
    if (newIds.length === 0) return;

    for (const id of newIds) {
      try {
        const details = await gmailClient.users.messages.get({ userId: 'me', id, format: 'full' });
        let body = '';
        if (details.data.payload.parts) {
          const textPart = details.data.payload.parts.find(p => p.mimeType === 'text/plain') ||
                           details.data.payload.parts.find(p => p.mimeType === 'text/html');
          if (textPart && textPart.body.data) body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
        } else if (details.data.payload.body && details.data.payload.body.data) {
          body = Buffer.from(details.data.payload.body.data, 'base64').toString('utf8');
        }
        await insertAppealFromEmail(body);
      } catch (err) {
        console.error("Ошибка обработки письма:", err.message);
      }
    }
    cache.emailIds = [...cache.emailIds, ...newIds];
    cache.date = formattedDate;
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("Ошибка проверки почты:", err.message);
  }
}

// ---- Запуск автопроверки ----
async function startEmailChecker(telegramBot) {
  TELEGRAM_BOT = telegramBot;
  await initGmailClient();
  schedule.scheduleJob('*/30 * * * * *', checkNewEmails); // каждые 30 секунд
  console.log('Автопроверка заявок с почты каждые 30 сек ЗАПУЩЕНА!');
}

module.exports = { insertAppealFromEmail, startEmailChecker };
