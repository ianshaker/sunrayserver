// emailAppealHandler.js
const { createClient } = require("@supabase/supabase-js");
const TELEGRAM_CHAT_ID = -1002582438853;
const TELEGRAM_BOT = require("./telegramBot");

const SUPABASE_URL = "https://xyzkneqhggpxstxqbqhs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzIiwicmVmIjoieHl6a25lcWhnZ3B4c3R4cWJxaHMiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NjU1MTUzMiwiZXhwIjoyMDYyMTI3NTMyfQ.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLES_TO_CHECK = [
  "appeals",
  "appealsotkaz",
  "dobivashki",
  "dogovornew",
  "eventsnew",
  "zamerotkaz",
  "contractsfinalnew"
];

const PRODUCT_KEYWORDS = [
  "Рулонные шторы",
  "Римские шторы",
  "Жалюзи",
  "Москитные сетки"
];

function extractPhone(text) {
  const match = text.match(/\+7\s*\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return `8(${digits.substring(1, 4)})${digits.substring(4, 7)}-${digits.substring(7, 9)}-${digits.substring(9, 11)}`;
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return digits.substring(1);
  }
  if (digits.length === 10) {
    return digits;
  }
  return null;
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

async function getFreeAppealId() {
  const { data, error } = await supabase
    .from("ids")
    .select("appeal_id")
    .eq("is_used", false)
    .is("used_at", null)
    .order("id", { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) throw new Error("Нет свободных ID");
  return data[0].appeal_id;
}

async function markAppealIdUsed(appeal_id) {
  const used_at = new Date().toISOString();
  await supabase.from("ids").update({ is_used: true, used_at }).eq("appeal_id", appeal_id);
}

async function phoneExistsInAnyTable(normalizedPhone) {
  for (const table of TABLES_TO_CHECK) {
    const { data, error } = await supabase
      .from(table)
      .select("phone")
      .limit(1)
      .eq("phone", normalizedPhone);
    if (error) continue;
    if (data && data.length > 0) return true;
  }
  return false;
}

async function insertAppealFromEmail(emailText) {
  const phone = extractPhone(emailText);
  if (!phone) throw new Error("Телефон не найден");

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) throw new Error("Невалидный номер");

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
    phone: normalizedPhone,
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

  await TELEGRAM_BOT.sendMessage(
    TELEGRAM_CHAT_ID,
    `📨 <b>НОВАЯ ЗАЯВКА С ПОЧТЫ</b>\nНомер: <b>${appeal_id}</b>\nКлиент: <b>${name}</b>\nТелефон: <b>${phone}</b>\nГород: <b>${city}</b>\nПродукт: <b>${product_type}</b>`,
    { parse_mode: "HTML" }
  );

  return "Заявка создана";
}

module.exports = { insertAppealFromEmail };
