-- Реестр Telegram-чатов, где бот может выполнять отделённые действия.
-- Единая таблица на все отделы: задачи, расписание мастеров и т.д.
-- Управление из CRM — позже; сейчас сид из profiles.telegram_chat_id.

CREATE TABLE IF NOT EXISTS public.telegram_bot_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  profile_id UUID NULL REFERENCES public.profiles (id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'manager_personal',
  permissions TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_bot_chats_chat_id_key UNIQUE (chat_id),
  CONSTRAINT telegram_bot_chats_kind_check CHECK (
    kind IN ('manager_personal', 'department', 'masters', 'service', 'other')
  )
);

COMMENT ON TABLE public.telegram_bot_chats IS
  'Разрешённые чаты бота: chat_id, тип, права на действия. Расширяется из CRM.';

COMMENT ON COLUMN public.telegram_bot_chats.chat_id IS
  'Telegram chat_id (личный чат менеджера с ботом или группа).';

COMMENT ON COLUMN public.telegram_bot_chats.profile_id IS
  'Связь с profiles для личных чатов менеджеров; NULL для общих/служебных чатов.';

COMMENT ON COLUMN public.telegram_bot_chats.kind IS
  'Тип чата: manager_personal, department, masters, service, other.';

COMMENT ON COLUMN public.telegram_bot_chats.permissions IS
  'Права: task_create, task_actions, master_schedule (и др. по мере добавления фич).';

CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_active
  ON public.telegram_bot_chats (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_profile_id
  ON public.telegram_bot_chats (profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_permissions
  ON public.telegram_bot_chats USING GIN (permissions);

DROP TRIGGER IF EXISTS trg_telegram_bot_chats_updated_at ON public.telegram_bot_chats;

CREATE TRIGGER trg_telegram_bot_chats_updated_at
  BEFORE UPDATE ON public.telegram_bot_chats
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.telegram_bot_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_bot_chats_service_role_all ON public.telegram_bot_chats;

CREATE POLICY telegram_bot_chats_service_role_all
  ON public.telegram_bot_chats
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS telegram_bot_chats_authenticated_read ON public.telegram_bot_chats;

CREATE POLICY telegram_bot_chats_authenticated_read
  ON public.telegram_bot_chats
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- Известные чаты задач менеджеров (profiles.telegram_chat_id).
INSERT INTO public.telegram_bot_chats (chat_id, title, profile_id, kind, permissions, notes)
SELECT
  p.telegram_chat_id,
  COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(p.email), ''), 'Чат ' || p.telegram_chat_id::TEXT),
  p.id,
  'manager_personal',
  ARRAY['task_create']::TEXT[],
  'Сид из profiles.telegram_chat_id'
FROM public.profiles p
WHERE p.telegram_chat_id IS NOT NULL
ON CONFLICT (chat_id) DO UPDATE SET
  title = EXCLUDED.title,
  profile_id = EXCLUDED.profile_id,
  kind = EXCLUDED.kind,
  permissions = EXCLUDED.permissions,
  is_active = TRUE,
  notes = EXCLUDED.notes,
  updated_at = now();
