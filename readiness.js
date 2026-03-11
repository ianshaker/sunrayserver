// readiness.js - обработка уведомлений о готовности договоров

const READINESS_CHAT_ID = '-1001865267052'; // Замените на ваш chat_id

function formatReadinessMessage(data) {
  const { contractNumber, contractDate, clientName, phone, city, factorySummary, appealNumber } = data;
  
  // Формируем заголовок с номером договора и ID обращения
  let contractHeader = `<b>${contractNumber}</b>`;
  if (appealNumber) {
    contractHeader += ` (${appealNumber})`;
  }
  
  return `🔔 ЗАПРОС ГОТОВНОСТИ:

Договор ${contractHeader}
___
Дата договора: ${contractDate}
Клиент: ${clientName}
${phone}
Город: ${city || '—'}
___
Сводка по фабрикам:
${factorySummary}`;
}

function registerReadinessRoute(fastify, telegramBot) {
  fastify.post('/events/readiness', async (request, reply) => {
    try {
      console.log('📋 Получен запрос о готовности договора:', request.body);
      
      const {
        contractNumber,
        contractDate,
        clientName,
        phone,
        city,
        factorySummary,
        appealNumber
      } = request.body;

      if (!contractNumber || !clientName) {
        return reply.status(400).send({
          error: 'Отсутствуют обязательные поля: contractNumber или clientName'
        });
      }

      // Формируем сообщение о готовности
      const readinessMessage = formatReadinessMessage({
        contractNumber,
        contractDate,
        clientName,
        phone,
        city,
        factorySummary,
        appealNumber
      });

      // Отправляем в Telegram
      await telegramBot.sendMessage(READINESS_CHAT_ID, readinessMessage, {
        parse_mode: 'HTML'
      });

      console.log('✅ Уведомление о готовности отправлено успешно');
      
      return reply.send({
        success: true,
        message: 'Уведомление о готовности отправлено в Telegram'
      });
      
    } catch (error) {
      console.error('❌ Ошибка при отправке уведомления о готовности:', error);
      return reply.status(500).send({
        error: 'Ошибка сервера при отправке уведомления',
        details: error.message
      });
    }
  });
}

module.exports = { registerReadinessRoute };
