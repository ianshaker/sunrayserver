-- ============================================================================
-- Модуль «Дедлайны погрузки» — трекинг уведомлений в таблице eventsnew.
--
-- Логика: бот кидает в чат «Погрузка» по одной карточке с сегодняшним
-- eventsnew.deadline (type = 'Погрузка'); пока менеджер не сменит дедлайн
-- в CRM (сброс deadline_notif_*), каждые 30 мин шлётся ⏰-пинг с удалением
-- предыдущего.
-- ============================================================================

ALTER TABLE public.eventsnew
  ADD COLUMN IF NOT EXISTS deadline_notif_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deadline_notif_tg_msg_id   BIGINT,
  ADD COLUMN IF NOT EXISTS deadline_reminder_tg_msg_id BIGINT;

COMMENT ON COLUMN public.eventsnew.deadline_notif_sent_at IS
  'Когда бот отправил карточку дедлайна погрузки в Telegram';

COMMENT ON COLUMN public.eventsnew.deadline_notif_tg_msg_id IS
  'Telegram message_id исходной карточки дедлайна погрузки (цель reply_to для напоминаний)';

COMMENT ON COLUMN public.eventsnew.deadline_reminder_tg_msg_id IS
  'Telegram message_id последнего ⏰-напоминания по дедлайну погрузки (удаляется перед следующим пингом)';

-- Очередь воркера: сегодняшние Погрузка с/без отправленного уведомления.
CREATE INDEX IF NOT EXISTS idx_eventsnew_loading_deadline_queue
  ON public.eventsnew (deadline, deadline_notif_sent_at)
  WHERE type = 'Погрузка' AND deadline IS NOT NULL;

-- Право loading_deadline на чат «НА ЗАМЕР» / Погрузка.
UPDATE public.telegram_bot_chats
SET
  permissions = array_append(permissions, 'loading_deadline'),
  updated_at = now()
WHERE chat_id = -1002669673493
  AND NOT ('loading_deadline' = ANY (permissions));
