-- Происхождение задачи из Telegram: чтобы напоминание приходило reply-ответом
-- на сообщение-отбивку о создании в том же чате.

ALTER TABLE public.manager_tasks
  ADD COLUMN IF NOT EXISTS tg_chat_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS tg_message_id BIGINT NULL;

COMMENT ON COLUMN public.manager_tasks.tg_chat_id IS
  'Telegram chat_id, где задача создана из бота (для reply-напоминаний). NULL для задач из CRM.';

COMMENT ON COLUMN public.manager_tasks.tg_message_id IS
  'message_id сообщения-отбивки о создании задачи. Напоминание шлётся reply на него.';
