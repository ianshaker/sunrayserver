-- ============================================================================
-- Карусель очереди дедлайнов погрузки.
--
-- До этого бот держал самую старую заявку с наступившим дедлайном и пинговал
-- её, пока менеджер не закроет: #07273 висела с 22.07.2026, за ней стояли 56.
-- Теперь после N пингов подряд заявка откладывается до следующего дня и уходит
-- в конец круга, а бот берёт следующую. Заявка не закрывается и не теряется.
-- ============================================================================

ALTER TABLE public.eventsnew
  ADD COLUMN IF NOT EXISTS deadline_reminder_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deadline_snoozed_until  DATE,
  ADD COLUMN IF NOT EXISTS deadline_snoozed_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.eventsnew.deadline_reminder_count IS
  'Сколько ⏰-пингов подряд ушло по этой погрузке с момента показа карточки (сброс при действии менеджера и при откладывании).';

COMMENT ON COLUMN public.eventsnew.deadline_snoozed_until IS
  'Дата (MSK), до наступления которой заявка не участвует в очереди пингов. NULL = участвует.';

COMMENT ON COLUMN public.eventsnew.deadline_snoozed_at IS
  'Когда заявку отложили в последний раз — определяет место в круге: кого отложили раньше, тот вернётся раньше.';

-- Очередь активных карточек читает отложенность вместе с дедлайном.
CREATE INDEX IF NOT EXISTS idx_eventsnew_loading_deadline_rotation
  ON public.eventsnew (deadline_snoozed_until, deadline_snoozed_at, deadline)
  WHERE type = 'Погрузка' AND deadline IS NOT NULL;
