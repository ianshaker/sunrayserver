const WEEKDAYS_RU = [
  "воскресенье", "понедельник", "вторник",
  "среда", "четверг", "пятница", "суббота"
];

function formatDate(dateString) {
  if (!dateString) return "";

  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    d = new Date(dateString + "T00:00:00");
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split(".");
    d = new Date(`${year}-${month}-${day}T00:00:00`);
  } else {
    d = new Date(dateString);
  }
  if (isNaN(d)) return dateString;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const weekday = WEEKDAYS_RU[d.getDay()];
  return `${day}.${month}.${year} (${weekday})`;
}

function formatTime(t) {
  if (!t) return "";
  const parts = t.split(":");
  return `${parts[0] || "00"}.${parts[1] || "00"}`;
}

function formatTimeRange(start, end) {
  if (!start && !end) return "";
  return `${formatTime(start)}${end ? "-" + formatTime(end) : ""}`;
}

function registerZamerRoute(fastify, telegramBot) {
  fastify.post("/events/zamer", async (request, reply) => {
    try {
      const {
        appealNumber,
        clientName,
        phone,
        city,
        address,
        detailedAddress,
        dialog,
        masterName,
        date,
        startTime,
        endTime,
        eventType,
        updateType,
        oldMaster
      } = request.body;

      const LOADING_CHAT_ID = -1002669673493;
      const MASTER_CHAT_IDS = {
        "ТИМУР": -1001948267386,
        "РОМА": -1001962103813,
        "ЛЕША": -1002504122184,
        "АНТОН": -1002314044639,
        "ЕВГЕНИЙ": -1002532739628,
        "ВЛАДИМИР": -1002395698353,
        "СЕМЕН": -1001907257943,
        "АЛЕКСЕЙ": -1002474207557,
        "ДАНИИЛ": -1002573504528,
        "ДИМА": -1002882550504,
        "УГЛОВ": -1002762072704,
      };

      const normalizedName = masterName ? String(masterName).trim().toUpperCase() : null;
      const prevNormalizedName = oldMaster ? String(oldMaster).trim().toUpperCase() : null;
      const formattedDate = formatDate(date);
      const formattedTime = formatTimeRange(startTime, endTime);

      // 1. Обновление (смена даты/времени)
      if (updateType === "updated" && normalizedName) {
        const chatId = MASTER_CHAT_IDS[normalizedName];
        if (chatId) {
          let msg = `ОБНОВЛЕНИЕ ПО ЗАМЕРУ ${appealNumber || ""}\n----------------------\n`;
          msg += `Клиент: ${clientName || ""} ${phone || ""}\n`;
          msg += city ? `Город: ${city}\n` : "";
          msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
          msg += detailedAddress ? `Детальный: ${detailedAddress}\n` : "";
          msg += dialog ? `Диалог: ${dialog}\n` : "";
          msg += "---------------------\n";
          msg += `Мастер: ${masterName || ""}\n`;
          msg += formattedDate ? `Дата: ${formattedDate}\n` : "";
          msg += formattedTime ? `Время: ${formattedTime}\n` : "";
          await telegramBot.sendMessage(chatId, msg);
        }
        return reply.send({ status: "ok", sent: true, chatId, type: "update" });
      }

      // 2. Переназначение мастера
      if (updateType === "reassigned") {
        // Старому мастеру — отмена
        if (prevNormalizedName && MASTER_CHAT_IDS[prevNormalizedName]) {
          let cancelMsg = `❌ ЗАМЕР ОТМЕНЁН\nЗамер ${appealNumber || ""}\n`;
          cancelMsg += city ? `Город: ${city}\n` : "";
          cancelMsg += address ? `Адрес: (технический адрес скрыт)\n` : "";
          cancelMsg += formattedDate ? `Дата: ${formattedDate}\n` : "";
          cancelMsg += formattedTime ? `Время: ${formattedTime}\n` : "";
          cancelMsg += `Переназначен другому мастеру.`;
          await telegramBot.sendMessage(MASTER_CHAT_IDS[prevNormalizedName], cancelMsg);
        }
        // Новому мастеру — полная карточка
        if (normalizedName && MASTER_CHAT_IDS[normalizedName]) {
          let msg = `ЗАЯВКА НА ЗАМЕР ${appealNumber || ""}\n----------------------\n`;
          msg += `Клиент: ${clientName || ""} ${phone || ""}\n`;
          msg += city ? `Город: ${city}\n` : "";
          msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
          msg += detailedAddress ? `Детальный: ${detailedAddress}\n` : "";
          msg += dialog ? `Диалог: ${dialog}\n` : "";
          msg += "---------------------\n";
          msg += `Мастер: ${masterName || ""}\n`;
          msg += formattedDate ? `Дата: ${formattedDate}\n` : "";
          msg += formattedTime ? `Время: ${formattedTime}\n` : "";
          await telegramBot.sendMessage(MASTER_CHAT_IDS[normalizedName], msg);
        }
        return reply.send({ status: "ok", sent: true, type: "reassigned" });
      }

      // 3. Обычная заявка или погрузка
      const isLoading = !masterName || masterName.trim() === "" || masterName.toLowerCase().includes("погрузка");
      let chatId, msg;
      if (isLoading) {
        chatId = LOADING_CHAT_ID;
        msg = `ЗАЯВКА НА ПОГРУЗКУ ${appealNumber || ""}\n----------------------\n`;
        msg += `Клиент: ${clientName || ""} ${phone || ""}\n`;
        msg += city ? `Город: ${city}\n` : "";
        msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
        msg += detailedAddress ? `Детальный: ${detailedAddress}\n` : "";
        msg += dialog ? `Диалог: ${dialog}\n` : "";
        msg += "---------------------\n";
      } else {
        chatId = MASTER_CHAT_IDS[normalizedName];
        if (!chatId) {
          return reply.code(400).send({ status: "error", message: `Чат для мастера "${masterName}" не найден!` });
        }
        msg = `ЗАЯВКА НА ЗАМЕР ${appealNumber || ""}\n----------------------\n`;
        msg += `Клиент: ${clientName || ""} ${phone || ""}\n`;
        msg += city ? `Город: ${city}\n` : "";
        msg += address ? `Адрес: (технический адрес скрыт)\n` : "";
        msg += detailedAddress ? `Детальный: ${detailedAddress}\n` : "";
        msg += dialog ? `Диалог: ${dialog}\n` : "";
        msg += "---------------------\n";
        msg += `Мастер: ${masterName || ""}\n`;
        msg += formattedDate ? `Дата: ${formattedDate}\n` : "";
        msg += formattedTime ? `Время: ${formattedTime}\n` : "";
      }

      await telegramBot.sendMessage(chatId, msg);

      reply.send({
        status: "ok",
        sent: true,
        chatId,
        type: isLoading ? "loading" : "zamer",
        master: masterName || null
      });
    } catch (e) {
      reply.code(500).send({ status: "error", error: e.message });
    }
  });
}

module.exports = { registerZamerRoute };