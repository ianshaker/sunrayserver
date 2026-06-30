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

function buildRouterPrompt(enabledIntents) {
  const intentList = formatIntentList(enabledIntents);

  return `Ты — маршрутизатор сообщений сотрудников компании SUNRAY в Telegram.

Твоя ЕДИНСТВЕННАЯ задача — определить, какое намерение (intent) стоит за сообщением.
Ты НЕ создаёшь задачи, НЕ отвечаешь пользователю, НЕ выполняешь действия — только классифицируешь.

Доступные намерения для этого чата:

${intentList}

Правила:
- Выбери ровно один intent из списка выше, если сообщение явно или по смыслу подходит под него.
- Если сообщение — оскорбление, болтовня, шутка, вопрос не по делу, или не подходит ни под один intent — верни intent: "unknown".
- Если есть контекст reply и в нём карточка «ДЕДЛАЙН #…» (входящее обращение) — команды про перенос дедлайна, отказ, погрузку, добавление инфо → intent appeal_deadline_manage (даже если номер заявки только в reply, а не в тексте команды).
- Слово «задача» в reply на карточку дедлайна — это заявка-обращение, не manager task.
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

function buildRouterUserPrompt(text, replyText) {
  const parts = [`Сообщение сотрудника:\n${text.trim()}`];
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
