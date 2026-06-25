-- =============================================================================
-- Mango Office: звонки + записи + расшифровки
-- Выполнить в Supabase SQL Editor (Dashboard → SQL → New query)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Таблица звонков
-- Одна строка = один звонок. Один номер клиента → много строк (история).
-- Связка с Mango: entry_id (уникален). Связка с CRM: client_phone_digits.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mango_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Mango
    entry_id text NOT NULL,
    call_id text,
    recording_id text,

    -- Клиент (формат как в appeals: 8(903)601-41-36)
    client_phone text NOT NULL,
    client_phone_digits text NOT NULL,

    -- Менеджер / линия
    manager_name text,
    manager_extension text,
    manager_phone text,
    line_number text,
    line_name text,

    -- 1 = входящий, 2 = исходящий
    direction smallint NOT NULL DEFAULT 1,

    -- Время (из summary Mango, UTC+3 → timestamptz)
    call_started_at timestamptz,
    call_answered_at timestamptz,
    call_ended_at timestamptz,

    wait_seconds integer NOT NULL DEFAULT 0,
    ring_seconds integer NOT NULL DEFAULT 0,
    talk_seconds integer NOT NULL DEFAULT 0,
    total_seconds integer NOT NULL DEFAULT 0,

    answered boolean NOT NULL DEFAULT false,
    disconnect_reason integer,
    disconnect_label text,

    -- Запись: pending → downloading → ready | failed | skipped
    recording_status text NOT NULL DEFAULT 'pending',
    storage_bucket text NOT NULL DEFAULT 'call-recordings',
    storage_path text,
    recording_size_bytes bigint,
    mango_recording_url text,

    -- Расшифровка (Google Speech / Gemini — позже)
    transcript_status text NOT NULL DEFAULT 'pending',
    transcript text,
    transcript_model text,
    transcript_error text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mango_calls_entry_id_unique UNIQUE (entry_id),
    CONSTRAINT mango_calls_recording_id_unique UNIQUE (recording_id),
    CONSTRAINT mango_calls_direction_check CHECK (direction IN (1, 2)),
    CONSTRAINT mango_calls_recording_status_check CHECK (
        recording_status IN ('pending', 'downloading', 'ready', 'failed', 'skipped')
    ),
    CONSTRAINT mango_calls_transcript_status_check CHECK (
        transcript_status IN ('pending', 'processing', 'done', 'failed', 'skipped')
    )
);

COMMENT ON TABLE public.mango_calls IS 'История звонков Mango Office: метаданные, файл записи, расшифровка';
COMMENT ON COLUMN public.mango_calls.entry_id IS 'ID группы вызова Mango — главный ключ для webhook summary/recording';
COMMENT ON COLUMN public.mango_calls.client_phone_digits IS 'Только цифры для поиска из CRM (89036014136)';
COMMENT ON COLUMN public.mango_calls.storage_path IS 'Путь в bucket call-recordings, напр. 2025/06/MjM3MjMyMjY0MDY=.mp3';

-- ---------------------------------------------------------------------------
-- 2. Индексы (история по номеру в хронологическом порядке)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_mango_calls_client_phone_digits
    ON public.mango_calls (client_phone_digits);

CREATE INDEX IF NOT EXISTS idx_mango_calls_client_history
    ON public.mango_calls (client_phone_digits, call_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_mango_calls_recording_status
    ON public.mango_calls (recording_status)
    WHERE recording_status IN ('pending', 'downloading');

CREATE INDEX IF NOT EXISTS idx_mango_calls_transcript_status
    ON public.mango_calls (transcript_status)
    WHERE transcript_status = 'pending' AND recording_status = 'ready';

-- ---------------------------------------------------------------------------
-- 3. updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mango_calls_updated_at ON public.mango_calls;
CREATE TRIGGER trg_mango_calls_updated_at
    BEFORE UPDATE ON public.mango_calls
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Нормализация телефона (как в Node: только цифры, 8/7 → 8XXXXXXXXXX)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_phone_digits(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    d text;
BEGIN
    IF raw IS NULL OR btrim(raw) = '' THEN
        RETURN NULL;
    END IF;

    d := regexp_replace(raw, '\D', '', 'g');

    IF length(d) = 11 AND left(d, 1) IN ('7', '8') THEN
        RETURN '8' || substring(d from 2);
    ELSIF length(d) = 10 THEN
        RETURN '8' || d;
    END IF;

    RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.format_phone_classic(digits text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    d text;
BEGIN
    d := public.normalize_phone_digits(digits);
    IF d IS NULL OR length(d) <> 11 THEN
        RETURN digits;
    END IF;
    RETURN format(
        '8(%s)%s-%s-%s',
        substring(d from 2 for 3),
        substring(d from 5 for 3),
        substring(d from 8 for 2),
        substring(d from 10 for 2)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Запрос истории звонков для CRM-модалки
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_mango_calls_by_phone(search_phone text)
RETURNS SETOF public.mango_calls
LANGUAGE sql
STABLE
AS $$
    SELECT mc.*
    FROM public.mango_calls mc
    WHERE mc.client_phone_digits = public.normalize_phone_digits(search_phone)
       OR mc.client_phone_digits LIKE '%' || right(public.normalize_phone_digits(search_phone), 10)
    ORDER BY mc.call_started_at DESC NULLS LAST, mc.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_mango_calls_by_phone IS
    'Все звонки клиента по номеру, новые сверху. Для модалок CRM.';

-- ---------------------------------------------------------------------------
-- 6. Storage bucket для mp3
-- Private: скачивание через signed URL или service role на сервере
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'call-recordings',
    'call-recordings',
    false,
    52428800,
    ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 7. RLS — таблица
-- Сервер сейчас использует anon key: политики ниже под authenticated CRM.
-- Для записи с Node-сервера позже добавьте service_role key или отдельную policy.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mango_calls ENABLE ROW LEVEL SECURITY;

-- Чтение для авторизованных пользователей CRM
DROP POLICY IF EXISTS mango_calls_select_authenticated ON public.mango_calls;
CREATE POLICY mango_calls_select_authenticated
    ON public.mango_calls
    FOR SELECT
    TO authenticated
    USING (true);

-- Вставка/обновление с сервера (временно через service_role в коде;
-- если CRM пишет сама — раскомментируйте authenticated insert/update)
DROP POLICY IF EXISTS mango_calls_all_service_role ON public.mango_calls;
CREATE POLICY mango_calls_all_service_role
    ON public.mango_calls
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 8. RLS — storage
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS call_recordings_read_authenticated ON storage.objects;
CREATE POLICY call_recordings_read_authenticated
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS call_recordings_write_service_role ON storage.objects;
CREATE POLICY call_recordings_write_service_role
    ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'call-recordings')
    WITH CHECK (bucket_id = 'call-recordings');
