-- =============================================================================
-- Комменты менеджеров к фактам дня (многие ответы на одну ситуацию).
-- НЕ JSON в одном столбце: отдельная таблица — безопасно при параллельной записи.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.home_daily_highlight_replies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- К какой ситуации (строке home_daily_highlights)
    highlight_id uuid NOT NULL
        REFERENCES public.home_daily_highlights (id) ON DELETE CASCADE,

    -- Автор (auth.users)
    user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

    -- Отображаемое имя на момент отправки (full_name / ник)
    author_name text NOT NULL,

    -- Текст комментария
    body text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT home_daily_highlight_replies_body_len
        CHECK (char_length(btrim(body)) BETWEEN 1 AND 280)
);

COMMENT ON TABLE public.home_daily_highlight_replies IS
    'Ответы менеджеров на факт дня (много строк на один highlight)';
COMMENT ON COLUMN public.home_daily_highlight_replies.highlight_id IS
    'home_daily_highlights.id — ситуация, к которой коммент';
COMMENT ON COLUMN public.home_daily_highlight_replies.author_name IS
    'Имя для UI; дублируем, чтобы не джойнить profiles на каждом чтении';

CREATE INDEX IF NOT EXISTS idx_home_daily_highlight_replies_highlight
    ON public.home_daily_highlight_replies (highlight_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_home_daily_highlight_replies_user
    ON public.home_daily_highlight_replies (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.home_daily_highlight_replies ENABLE ROW LEVEL SECURITY;

-- Все авторизованные видят комменты коллег
DROP POLICY IF EXISTS home_daily_highlight_replies_select_authenticated
    ON public.home_daily_highlight_replies;
CREATE POLICY home_daily_highlight_replies_select_authenticated
    ON public.home_daily_highlight_replies
    FOR SELECT
    TO authenticated
    USING (true);

-- Писать можно только от своего user_id
DROP POLICY IF EXISTS home_daily_highlight_replies_insert_authenticated
    ON public.home_daily_highlight_replies;
CREATE POLICY home_daily_highlight_replies_insert_authenticated
    ON public.home_daily_highlight_replies
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Удалять/править — только свой коммент (на будущее)
DROP POLICY IF EXISTS home_daily_highlight_replies_update_own
    ON public.home_daily_highlight_replies;
CREATE POLICY home_daily_highlight_replies_update_own
    ON public.home_daily_highlight_replies
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS home_daily_highlight_replies_delete_own
    ON public.home_daily_highlight_replies;
CREATE POLICY home_daily_highlight_replies_delete_own
    ON public.home_daily_highlight_replies
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS home_daily_highlight_replies_all_service_role
    ON public.home_daily_highlight_replies;
CREATE POLICY home_daily_highlight_replies_all_service_role
    ON public.home_daily_highlight_replies
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
