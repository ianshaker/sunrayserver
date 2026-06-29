// ============================================================================
// Промпт для контекстного поиска задачи (Ветка B):
// сотрудник называет задачу по смыслу/словам, а не по номеру.
//
// Один вызов Gemini — текст сотрудника + список активных задач.
// Gemini ищет совпадение по смыслу и возвращает: found / ambiguous / not_found.
// ============================================================================

/**
 * Строит компактное текстовое представление задачи для промпта.
 * Описание обрезается до 120 символов — в Gemini и так хватит.
 */
function formatTaskForPrompt(task) {
  const due = task.due_date
    ? new Date(task.due_date).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const parts = [`#${task.task_number}: ${task.title || "(без названия)"}`];
  if (task.description) parts.push(`  Описание: ${task.description.slice(0, 120)}`);
  if (due) parts.push(`  Дедлайн: ${due} МСК`);
  return parts.join("\n");
}

function buildContextSearchPrompt(action) {
  const actionDesc = {
    complete: "завершить / выполнить / закрыть",
    cancel: "отменить / «не нужно» / «отбой»",
    delete: "удалить навсегда / «удали» / «сотри»",
    reschedule: "перенести / сдвинуть дедлайн",
  }[action] || "изменить";

  return `Ты — помощник менеджера в компании SUNRAY (жалюзи, шторы, замеры).
Сотрудник хочет выполнить действие «${actionDesc}» над одной из своих задач, но назвал её по смыслу, а не по номеру.
Ниже — список ВСЕХ активных задач. Найди, какую задачу имеет в виду сотрудник.

ПРАВИЛА:
1. Ищи совпадение по смыслу: заголовку, описанию, ключевым словам, именам, номерам телефонов.
2. Если нашёл РОВНО ОДНУ подходящую задачу — верни status "found" и её task_number.
3. Если подходящих задач НЕСКОЛЬКО (2–5) — верни status "ambiguous" и список candidates.
4. Если не нашёл ни одной подходящей — верни status "not_found".
5. НЕ выдумывай. Лучше "not_found", чем угадывать.

ФОРМАТ ОТВЕТА — только валидный JSON, без markdown:

Если нашёл одну:
{"status":"found","task_number":19,"reason":"Название «Купить 5 слонов» точно совпадает"}

Если несколько похожих:
{"status":"ambiguous","candidates":[{"task_number":17,"title":"Позвонить Татьяне"},{"task_number":21,"title":"Перезвонить Тарасовой"}]}

Если ничего:
{"status":"not_found"}`;
}

function buildContextSearchUserPrompt(text, tasks) {
  const taskList = tasks.map(formatTaskForPrompt).join("\n\n");
  return `Сообщение сотрудника:\n${text.trim()}\n\n---\nАктивные задачи (${tasks.length}):\n\n${taskList}`;
}

module.exports = { buildContextSearchPrompt, buildContextSearchUserPrompt };
