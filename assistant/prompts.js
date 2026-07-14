// ============================================================================
// Промпты классификатора интентов (этап 1 — только маршрутизация).
// ============================================================================

function formatIntentList(intents) {
  return intents
    .map((intent, index) => {
      const examples = (intent.examples || [])
        .slice(0, 5)
        .map((ex) => `    - «${ex}»`)
        .join("\n");
      return (
        `${index + 1}. intent: "${intent.name}"\n` +
        `   Название: ${intent.title || intent.name}\n` +
        `   Описание: ${intent.description}\n` +
        (examples ? `   Примеры:\n${examples}` : "")
      );
    })
    .join("\n\n");
}

/**
 * @param {object[]} enabledIntents
 * @param {{ title?: string, chatId?: number, permissions?: string[] } | null} chatContext
 */
function buildRouterPrompt(enabledIntents, chatContext = null) {
  const intentList = formatIntentList(enabledIntents);

  const chatTitle = chatContext?.title ? String(chatContext.title) : "—";
  const chatId =
    chatContext?.chatId != null ? String(chatContext.chatId) : "—";
  const perms = Array.isArray(chatContext?.permissions)
    ? chatContext.permissions.join(", ")
    : "—";
  const hasLoading = Array.isArray(chatContext?.permissions)
    && chatContext.permissions.includes("loading_deadline");
  const hasAppeal = Array.isArray(chatContext?.permissions)
    && chatContext.permissions.includes("appeal_deadline");

  let chatHint = "";
  if (hasLoading && !hasAppeal) {
    chatHint =
      "В ЭТОМ чате разрешены дедлайны ПОГРУЗКИ (loading_deadline_*), а не входящих. " +
      "Команды «перенеси дедлайн», «обнови телефон», «добавь инфо», «верни во входящие», «отказ» без уточнения «входящие» → loading_deadline_manage. " +
      "«дай/скинь дедлайны» без уточнения → loading_deadline_query.";
  } else if (hasAppeal && !hasLoading) {
    chatHint =
      "В ЭТОМ чате разрешены дедлайны ВХОДЯЩИХ (appeal_deadline_*), а не погрузки. " +
      "Команды «перенеси дедлайн / отказ / в погрузку» → appeal_deadline_manage. " +
      "«дай/покажи дедлайны» → appeal_deadline_query.";
  } else if (hasLoading && hasAppeal) {
    chatHint =
      "В чате есть и loading_deadline, и appeal_deadline — смотри маркеры «погрузк*/ДЕДЛАЙН ПОГРУЗКИ» vs «входящ*/ДЕДЛАЙН #» без ПОГРУЗКИ.";
  }

  return `Ты — маршрутизатор сообщений сотрудников компании SUNRAY в Telegram.

Твоя ЕДИНСТВЕННАЯ задача — определить, какое намерение (intent) стоит за сообщением.
Ты НЕ создаёшь задачи, НЕ отвечаешь пользователю, НЕ выполняешь действия — только классифицируешь.

Контекст текущего чата:
- Название: «${chatTitle}»
- chat_id: ${chatId}
- Права: ${perms}
${chatHint ? `- Подсказка по чату: ${chatHint}` : ""}

Доступные намерения для этого чата:

${intentList}

Правила:
- Выбери ровно один intent из списка выше, если сообщение явно или по смыслу подходит под него.
- Если сообщение — оскорбление, болтовня, шутка, вопрос не по делу, или не подходит ни под один intent — верни intent: "unknown".
- Учитывай КОНТЕКСТ ЧАТА выше: права и название сильно подсказывают домен (погрузка vs входящие vs задачи).
- Если есть контекст reply и в нём карточка «ДЕДЛАЙН ПОГРУЗКИ #…» — команды про перенос/обновление инфо → intent loading_deadline_manage (не appeal_deadline_*).
- Если есть контекст reply и в нём карточка «ДЕДЛАЙН #…» (входящее обращение, БЕЗ слова ПОГРУЗКИ) — команды про перенос дедлайна, отказ, погрузку, добавление инфо → intent appeal_deadline_manage (даже если номер заявки только в reply, а не в тексте команды).
- Слово «задача» в reply на карточку дедлайна входящих — это заявка-обращение, не manager task.
- Вопросы/просьбы ПОКАЗАТЬ дедлайны по погрузке / по замерам / в отделе погрузки («дай», «скинь», «покажи», «какие», «есть ли», «самый срочный», «прошедшие», «последние N») → loading_deadline_query, НЕ appeal_deadline_* и НЕ task_*.
- Вопросы/просьбы ПОКАЗАТЬ дедлайны по входящим/заявкам/обращениям («дай», «покажи», «какие», «есть ли», «список», «самый срочный», «прошедшие», «последние N») → appeal_deadline_query, НЕ appeal_deadline_manage и НЕ task_* и НЕ loading_deadline_*.
- appeal_deadline_manage — только действие над конкретной входящей заявкой: перенести, отказ, погрузка, добавить инфо (обычно есть #NNNNN или reply на карточку ДЕДЛАЙН без ПОГРУЗКИ).
- loading_deadline_manage — действие над событием погрузки: перенести дедлайн, добавить инфо, отправить в отказ, вернуть во входящие, или назначить замер (мастер + дата + время). Обычно reply на «ДЕДЛАЙН ПОГРУЗКИ» или команда в чате с правом loading_deadline.
- «дедлайн» у manager-задачи («перенеси задачу», «создай задачу с дедлайном») → task_manage / task_create, не appeal_deadline_* и не loading_deadline_*.
- confidence: число от 0 до 1 — насколько уверен в классификации.
- reason: одно короткое предложение на русском, почему выбран этот intent.

ФОРМАТ ОТВЕТА — только валидный JSON, без markdown:
{
  "intent": "task_create",
  "confidence": 0.92,
  "reason": "Пользователь просит напомнить о звонке завтра"
}

Для unknown:
{
  "intent": "unknown",
  "confidence": 0.95,
  "reason": "Сообщение не относится ни к одному доступному сценарию"
}`;
}

/**
 * @param {string} text
 * @param {string|null|undefined} replyText
 * @param {{ title?: string, chatId?: number, permissions?: string[] } | null} chatContext
 */
function buildRouterUserPrompt(text, replyText, chatContext = null) {
  const parts = [];
  if (chatContext?.title || chatContext?.chatId != null) {
    const perms = Array.isArray(chatContext.permissions)
      ? chatContext.permissions.join(", ")
      : "—";
    parts.push(
      `Чат: «${chatContext.title || "—"}» (id=${chatContext.chatId ?? "—"}), права: ${perms}`,
    );
  }
  parts.push(`Сообщение сотрудника:\n${text.trim()}`);
  if (replyText) {
    parts.push(
      `\nКонтекст — сообщение, на которое сотрудник сделал ответ (reply):\n${replyText.trim().slice(0, 600)}`,
    );
  }
  return parts.join("\n");
}

module.exports = {
  buildRouterPrompt,
  buildRouterUserPrompt,
};
