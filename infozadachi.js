// infozadachi.js

// Маппинг UUID пользователей на Telegram chat_id
const USER_CHAT_MAPPING = {
  // Суперадмин
  "943603c3-abd0-47f8-af95-1e60a06fc8b1": -1002614770458, // Ian Mironov
  
  // Пользователи
  "de22f2df-66bc-444b-b2b8-104bf79bd166": -1002653986952, // Акоп Шушанян
  "c29869e0-473f-4a3e-a517-687a1a1c0e42": -1002851777686, // Александра Балукова
  "2bae2352-8c7c-4b64-9e7d-f419c2f1b595": -1002701215940, // Антон
  "f687a6de-9da9-48e4-ae0d-0460bd03edf3": -1002625500997, // Глеб Миронов
  "a1df15d4-24b4-4120-a18e-8f7e000ff574": -1002502050227, // Даник Миронов
  "6f816db9-70f3-463f-b01b-66a1825e505c": -1002881581162, // Елена Миронова
  "44a38a17-bc35-49a8-9a34-27c78310fd9c": -1002712226725, // Косарева Ирина
  "3438c85f-b7e8-4e19-aa5b-0391441619fb": -1002791005609, // Настя
  "c9fa6e25-b2ae-4e68-ad4e-e50bffebd071": -1002602155266, // Поздеев Геннадий
  "1712a00e-da83-4bbb-ad3e-d2884edfce1d": -1002715490676, // Светлана
  "7b85819f-b95b-422b-93b0-4f021c178beb": -1002592223380, // Фаина Миронова
  "5572d59d-960d-43f1-b805-b60e42c2752c": -1002629184386, // Челтуиторь Екатерина
  "28906cb8-fb15-40d1-9a8f-13ba4079e6b9": -1002504122184  // Ян Шейкер
};

function registerTaskRoute(fastify, telegramBot) {
  fastify.post('/tasks/manager', async (request, reply) => {
    try {
      console.log('📥 Получено уведомление о задаче:', request.body);
      
      const { type, task, assignees, assigned_by, timestamp } = request.body;
      
      // Проверяем обязательные поля
      if (!type || !task || !assignees || !assigned_by) {
        return reply.status(400).send({ 
          error: 'Missing required fields',
          required: ['type', 'task', 'assignees', 'assigned_by']
        });
      }

      // Обработка разных типов уведомлений
      switch (type) {
        case 'task_created':
          await handleTaskCreated(task, assignees, assigned_by, telegramBot);
          break;
        case 'task_updated':
          await handleTaskUpdated(task, assignees, assigned_by, telegramBot);
          break;
        case 'task_completed':
          await handleTaskCompleted(task, assignees, assigned_by, telegramBot);
          break;
        default:
          console.log('⚠️ Неизвестный тип уведомления:', type);
      }

      return reply.status(200).send({ 
        status: 'success',
        message: 'Task notification processed',
        processed_at: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Ошибка обработки уведомления о задаче:', error);
      return reply.status(500).send({ 
        error: 'Internal server error',
        message: error.message 
      });
    }
  });
}

async function handleTaskCreated(task, assignees, assigned_by, telegramBot) {
  console.log('🆕 Обработка создания новой задачи:', task.title);
  
  // Отправляем уведомления ТОЛЬКО исполнителям (не создателю)
  for (const assignee of assignees) {
    // Пропускаем отправку уведомления создателю задачи
    if (assignee.id === assigned_by.id) {
      console.log(`⏭️ Пропускаем отправку уведомления создателю ${assignee.full_name}`);
      continue;
    }

    const chatId = USER_CHAT_MAPPING[assignee.id];
    
    if (!chatId) {
      console.log(`⚠️ Не найден chat_id для пользователя ${assignee.full_name} (${assignee.id})`);
      continue;
    }

    const message = `
🔔 Новая задача!
От: ${assigned_by.full_name}
___
*${task.title}*
${task.description ? `_${task.description}_` : ''}
___
Приоритет: ${getPriorityEmoji(task.priority)} ${getPriorityText(task.priority)}
Срок: *${task.due_date ? formatDate(task.due_date) : 'Не указан'}*
Время создания: ${formatDate(task.created_at)}
    `.trim();

    try {
      await telegramBot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      console.log(`✅ Уведомление отправлено для ${assignee.full_name} в чат ${chatId}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления для ${assignee.full_name}:`, error);
    }
  }
}

async function handleTaskUpdated(task, assignees, assigned_by, telegramBot) {
  console.log('🔄 Обработка обновления задачи:', task.title);
  
  for (const assignee of assignees) {
    const chatId = USER_CHAT_MAPPING[assignee.id];
    
    if (!chatId) {
      console.log(`⚠️ Не найден chat_id для пользователя ${assignee.full_name} (${assignee.id})`);
      continue;
    }

    const message = `
🔄 Задача обновлена!
От: ${assigned_by.full_name}
___
*${task.title}*
${task.description ? `_${task.description}_` : ''}
___
Приоритет: ${getPriorityEmoji(task.priority)} ${getPriorityText(task.priority)}
Статус: ${getStatusEmoji(task.status)} ${getStatusText(task.status)}
Срок: *${task.due_date ? formatDate(task.due_date) : 'Не указан'}*
    `.trim();

    try {
      await telegramBot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      console.log(`✅ Уведомление об обновлении отправлено для ${assignee.full_name}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления об обновлении:`, error);
    }
  }
}

async function handleTaskCompleted(task, assignees, assigned_by, telegramBot) {
  console.log('✅ Обработка завершения задачи:', task.title);
  
  // Уведомляем создателя задачи о завершении
  const creatorChatId = USER_CHAT_MAPPING[assigned_by.id];
  if (creatorChatId) {
    const message = `
🎉 Задача завершена!
___
*${task.title}*
___
Выполнили: ${assignees.map(a => a.full_name).join(', ')}
Статус: ✅ Завершено
Время завершения: *${formatDate(new Date().toISOString())}*
    `.trim();

    try {
      await telegramBot.sendMessage(creatorChatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      console.log(`✅ Уведомление о завершении отправлено создателю ${assigned_by.full_name}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки уведомления о завершении:`, error);
    }
  }
}

function getPriorityEmoji(priority) {
  switch (priority) {
    case 'urgent': return '🔥';
    case 'high': return '⚡';
    case 'medium': return '⚪';
    case 'low': return '🔵';
    default: return '⚪';
  }
}

function getPriorityText(priority) {
  switch (priority) {
    case 'urgent': return 'Срочно';
    case 'high': return 'Высокий';
    case 'medium': return 'Средний';
    case 'low': return 'Низкий';
    default: return 'Средний';
  }
}

function getStatusEmoji(status) {
  switch (status) {
    case 'pending': return '⏳';
    case 'in_progress': return '🔄';
    case 'completed': return '✅';
    case 'cancelled': return '❌';
    default: return '⏳';
  }
}

function getStatusText(status) {
  switch (status) {
    case 'pending': return 'Ожидает';
    case 'in_progress': return 'В работе';
    case 'completed': return 'Завершено';
    case 'cancelled': return 'Отменено';
    default: return 'Ожидает';
  }
}

function formatDate(dateString) {
  if (!dateString) return 'Не указано';
  const date = new Date(dateString);
  return date.toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

module.exports = { registerTaskRoute };