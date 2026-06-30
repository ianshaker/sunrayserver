-- ============================================================================
-- Модуль «Дедлайны входящих» — трекинг уведомлений в таблице appeals.
--
-- Логика: бот кидает в TG по одной заявке с сегодняшним reminder_date;
-- следующую отправляет только после того, как менеджер отреагировал
-- (deadline_resolved_at IS NOT NULL).
-- ============================================================================

-- 4 колонки для отслеживания состояния уведомления по дедлайну.
ALTER TABLE appeals
  ADD COLUMN IF NOT EXISTS deadline_notif_sent_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deadline_notif_tg_msg_id BIGINT,
  ADD COLUMN IF NOT EXISTS deadline_resolved_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deadline_resolution      TEXT
    CHECK (deadline_resolution IN ('reschedule', 'reject', 'loading', 'info_added', 'manual'));

-- Индекс для быстрого поиска очереди воркером (каждые 5 мин).
CREATE INDEX IF NOT EXISTS idx_appeals_deadline_queue
  ON appeals (reminder_date, deadline_notif_sent_at, deadline_resolved_at)
  WHERE status = 'Активно';

-- Регистрируем Telegram-чат «Входящие — дедлайны» (топик 3664).
-- chat_id = -1002585521272 из https://t.me/c/2585521272/3664
-- Разрешение appeal_deadline даёт доступ к интенту переноса дедлайна.
INSERT INTO telegram_bot_chats (chat_id, title, kind, permissions, is_active, notes)
VALUES (
  -1002585521272,
  'Входящие — дедлайны',
  'department',
  ARRAY['appeal_deadline'],
  true,
  'Топик 3664 в группе входящих. Бот сюда кидает карточки дедлайнов.'
)
ON CONFLICT (chat_id) DO UPDATE
  SET permissions = EXCLUDED.permissions,
      title       = EXCLUDED.title,
      is_active   = true,
      updated_at  = now();
