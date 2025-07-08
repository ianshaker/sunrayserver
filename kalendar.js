// kalendar.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://xyzkneqhggpxstxqbqhs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5emtuZXFoZ2dweHN0eHFicWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NTE1MzIsImV4cCI6MjA2MjEyNzUzMn0.HmkcuxviENuQbiYgyQh0MBPr5zYlk88YLnRBlTXaKUU'; // свой ключ
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Массив мастеров по кнопкам
const MASTERS = [
  "ЛЕША", "АНТОН", "РОМА", "ТИМУР", "ЕВГЕНИЙ", "ДИМА", "АЛЕКСЕЙ", "ВЯЧЕСЛАВ", "СЕМЁН", "ВЛАДИМИР"
];

// Кнопки дней — 9 дней вперёд
function getDaysButtons() {
  const res = [];
  for (let i = 0; i < 9; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const day = d.getDate();
    const month = d.toLocaleString('ru', { month: 'short' }); // 'июн.'
    res.push({ text: `${day} ${month}`, callback_data: `day_${i}` });
  }
  return res;
}

// Главное меню: Календарь
async function handleCalendarMenu(bot, chatId) {
  const mastersButtons = MASTERS.map(m => [{ text: m, callback_data: `master_${m}` }]);
  await bot.sendMessage(chatId, 'Выбери мастера:', {
    reply_markup: { inline_keyboard: mastersButtons }
  });
}

// Обработка выбора мастера
async function handleMasterSelect(bot, chatId, master) {
  const daysBtns = getDaysButtons().map(btn => [btn]); // Каждая дата на отдельной строке
  await bot.sendMessage(chatId, `Мастер: ${master}\nВыбери день:`, {
    reply_markup: { inline_keyboard: daysBtns }
  });
}

// Получить расписание мастера на конкретный день
async function handleDaySelect(bot, chatId, master, dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const targetDate = d.toISOString().slice(0, 10); // "2025-06-01"
  const { data, error } = await supabase
    .from('eventsnew')
    .select('start_time, end_time, type, dialog')
    .eq('master', master)
    .eq('date', targetDate);

  if (error) {
    await bot.sendMessage(chatId, 'Ошибка получения расписания!');
    return;
  }

  if (!data || !data.length) {
    await bot.sendMessage(chatId, `У мастера ${master} на ${targetDate} нет событий.`);
    return;
  }

  let text = `📅 <b>Расписание ${master} на ${targetDate}:</b>\n\n`;
  for (const ev of data) {
    const st = ev.start_time?.slice(0,5) || "";
    const et = ev.end_time?.slice(0,5) || "";
    text += `⏰ <b>${st}–${et}</b> — <i>${ev.type || "Событие"}</i>\n`;
    if (ev.dialog) text += `Комментарий: ${ev.dialog.substring(0, 40)}\n`;
    text += '\n';
  }
  await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
}

// Главный обработчик: подключить в index.js или server.js
function registerCalendarBot(bot) {
  // Вызывается по команде "/calendar" или "Календарь событий"
  bot.onText(/\/calendar|Календарь событий/i, (msg) => {
    handleCalendarMenu(bot, msg.chat.id);
  });

  // Inline-кнопки
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    if (query.data.startsWith('master_')) {
      const master = query.data.replace('master_', '');
      bot.session = bot.session || {};
      bot.session[chatId] = { master };
      await handleMasterSelect(bot, chatId, master);
      await bot.answerCallbackQuery(query.id);
    }
    if (query.data.startsWith('day_')) {
      const dayOffset = Number(query.data.replace('day_', ''));
      const master = bot.session?.[chatId]?.master;
      if (!master) {
        await bot.sendMessage(chatId, 'Сначала выбери мастера!');
        return;
      }
      await handleDaySelect(bot, chatId, master, dayOffset);
      await bot.answerCallbackQuery(query.id);
    }
  });
}

module.exports = { registerCalendarBot };