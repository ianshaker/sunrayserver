-- З7, этап 1 (PLANS/PROXY/02-zashchita-servera): звонки (mango_calls) и mp3 (бакет call-recordings) недоступны публичному anon-ключу.
-- Слово Яна 17.10.2026: «ну если надо делай это в коннекте с папой антона».
-- Остаётся: CRM читает под вошедшим пользователем (authenticated), Render — service_role (обходит RLS), прокси 2.0 в базу не ходит.
-- Откат: повторно выполнить 20250625130000_mango_calls_anon_access.sql (DROP IF EXISTS + CREATE, идемпотентен).
-- Этап 2 (гранты, RPC get_mango_calls_by_phone) — отдельным файлом через сутки: PLANS/PROXY/02-zashchita-servera/z7-zakryt-anon-chernovik.sql.

BEGIN;

-- Страховка: без политики authenticated CRM потеряет звонки. Нет её — вся миграция откатывается.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mango_calls'
      AND policyname = 'mango_calls_select_authenticated'
  ) THEN
    RAISE EXCEPTION 'Нет политики mango_calls_select_authenticated — CRM потеряет звонки. Отмена.';
  END IF;
END $$;

DROP POLICY IF EXISTS mango_calls_anon_select ON public.mango_calls;
DROP POLICY IF EXISTS mango_calls_anon_insert ON public.mango_calls;
DROP POLICY IF EXISTS mango_calls_anon_update ON public.mango_calls;

DROP POLICY IF EXISTS call_recordings_anon_read   ON storage.objects;
DROP POLICY IF EXISTS call_recordings_anon_insert ON storage.objects;
DROP POLICY IF EXISTS call_recordings_anon_update ON storage.objects;

COMMIT;

-- Остаются: mango_calls_select_authenticated (SELECT, authenticated), mango_calls_all_service_role (ALL, service_role),
-- call_recordings_read_authenticated (SELECT, authenticated), call_recordings_write_service_role (ALL, service_role).
