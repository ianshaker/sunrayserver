-- =============================================================================
-- Ежедневные «факты дня» для главной плитки CRM
-- Сервер (04:00 МСК) генерирует 5 анонимизированных мыслей из расшифровок
-- звонков за вчера → CRM только читает готовую таблицу.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.home_daily_highlights (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Дата звонков-источников (вчера относительно генерации), дата по МСК
    highlight_date date NOT NULL,

    -- Слот 1..5 (топ-5 самых длинных расшифровок)
    slot smallint NOT NULL,

    -- Тип контента: сейчас только call_highlight; позже manager_achievement / personal_fact
    type text NOT NULL DEFAULT 'call_highlight',

    -- Задел под персонализацию (сейчас NULL)
    manager_name text,

    -- Связка с mango_calls для аудита (в CRM не показывается)
    source_entry_id text,

    -- Готовая фраза для показа на главной
    text text NOT NULL,

    -- Модель, которая сгенерировала текст
    model text,

    -- ready | failed
    status text NOT NULL DEFAULT 'ready',

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT home_daily_highlights_slot_check CHECK (slot BETWEEN 1 AND 5),
    CONSTRAINT home_daily_highlights_status_check CHECK (status IN ('ready', 'failed')),
    CONSTRAINT home_daily_highlights_date_slot_unique UNIQUE (highlight_date, slot)
);

COMMENT ON TABLE public.home_daily_highlights IS
    'Ежедневные факты/мысли для главной плитки CRM (из звонков и будущих достижений)';
COMMENT ON COLUMN public.home_daily_highlights.highlight_date IS
    'Дата звонков-источников (день по МСК), не дата показа';
COMMENT ON COLUMN public.home_daily_highlights.slot IS
    'Порядковый номер в топ-5 (1..5)';
COMMENT ON COLUMN public.home_daily_highlights.type IS
    'call_highlight | manager_achievement | personal_fact (расширяемо)';
COMMENT ON COLUMN public.home_daily_highlights.source_entry_id IS
    'mango_calls.entry_id — только для отладки, не для UI';

CREATE INDEX IF NOT EXISTS idx_home_daily_highlights_date
    ON public.home_daily_highlights (highlight_date DESC);

CREATE INDEX IF NOT EXISTS idx_home_daily_highlights_ready
    ON public.home_daily_highlights (highlight_date DESC)
    WHERE status = 'ready';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.home_daily_highlights ENABLE ROW LEVEL SECURITY;

-- CRM (authenticated) — только чтение готовых фактов
DROP POLICY IF EXISTS home_daily_highlights_select_authenticated ON public.home_daily_highlights;
CREATE POLICY home_daily_highlights_select_authenticated
    ON public.home_daily_highlights
    FOR SELECT
    TO authenticated
    USING (true);

-- service_role — полный доступ
DROP POLICY IF EXISTS home_daily_highlights_all_service_role ON public.home_daily_highlights;
CREATE POLICY home_daily_highlights_all_service_role
    ON public.home_daily_highlights
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- anon — SELECT/INSERT/UPDATE (сервер может писать anon-ключом, как mango_calls)
DROP POLICY IF EXISTS home_daily_highlights_anon_select ON public.home_daily_highlights;
CREATE POLICY home_daily_highlights_anon_select
    ON public.home_daily_highlights
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS home_daily_highlights_anon_insert ON public.home_daily_highlights;
CREATE POLICY home_daily_highlights_anon_insert
    ON public.home_daily_highlights
    FOR INSERT
    TO anon
    WITH CHECK (true);

DROP POLICY IF EXISTS home_daily_highlights_anon_update ON public.home_daily_highlights;
CREATE POLICY home_daily_highlights_anon_update
    ON public.home_daily_highlights
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);
