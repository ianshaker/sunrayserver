-- @Sunsseo (tg 6094092941) = Ian Mironov в CRM, НЕ профиль «Ян Шейкер».
-- Исправляет авторство задач из Telegram и привязку для resolveProfileIdByTelegramUser.

-- Снять ошибочную привязку с «Ян Шейкер»
UPDATE public.profiles SET
  telegram_username = NULL,
  telegram_user_id = NULL
WHERE id = '28906cb8-fb15-40d1-9a8f-13ba4079e6b9';

-- Ian Mironov (@Sunsseo)
UPDATE public.profiles SET
  telegram_username = 'sunsseo',
  telegram_user_id = 6094092941
WHERE id = '943603c3-abd0-47f8-af95-1e60a06fc8b1';

-- Задачи, созданные ботом с неверным assigned_by
UPDATE public.manager_tasks
SET
  assigned_by = '943603c3-abd0-47f8-af95-1e60a06fc8b1',
  assigned_to = '943603c3-abd0-47f8-af95-1e60a06fc8b1',
  assignees = ARRAY['943603c3-abd0-47f8-af95-1e60a06fc8b1']::uuid[]
WHERE assigned_by = '28906cb8-fb15-40d1-9a8f-13ba4079e6b9'
  AND tg_chat_id IS NOT NULL;
