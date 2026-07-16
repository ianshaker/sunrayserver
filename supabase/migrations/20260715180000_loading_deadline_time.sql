-- ============================================================================
-- Дедлайны погрузки: время напоминания (MSK wall-clock).
--
-- deadline DATE остаётся календарным днём.
-- deadline_time TIME — час:минута по Москве, как менеджер вводит в CRM
-- (13:00 = 13:00 МСК, без UTC-конвертации). Воркер сравнивает с «сейчас» MSK.
-- ============================================================================

ALTER TABLE public.eventsnew
  ADD COLUMN IF NOT EXISTS deadline_time TIME;

COMMENT ON COLUMN public.eventsnew.deadline_time IS
  'Время напоминания дедлайна погрузки (MSK wall-clock HH:MM). NULL = с начала дня дедлайна (legacy).';

-- Очередь: дата + время + флаг отправки.
DROP INDEX IF EXISTS idx_eventsnew_loading_deadline_queue;
CREATE INDEX IF NOT EXISTS idx_eventsnew_loading_deadline_queue
  ON public.eventsnew (deadline, deadline_time, deadline_notif_sent_at)
  WHERE type = 'Погрузка' AND deadline IS NOT NULL;
