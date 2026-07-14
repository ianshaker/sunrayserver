-- ID последнего ⏰-пинга по дедлайну входящей.
-- Перед новым напоминанием (каждые 30 мин) бот удаляет старое сообщение
-- и сохраняет message_id нового. Карточка остаётся в deadline_notif_tg_msg_id.

ALTER TABLE public.appeals
  ADD COLUMN IF NOT EXISTS deadline_reminder_tg_msg_id BIGINT;

COMMENT ON COLUMN public.appeals.deadline_notif_tg_msg_id IS
  'Telegram message_id исходной карточки дедлайна (цель reply_to для напоминаний)';

COMMENT ON COLUMN public.appeals.deadline_reminder_tg_msg_id IS
  'Telegram message_id последнего ⏰-напоминания (удаляется перед следующим пингом)';
