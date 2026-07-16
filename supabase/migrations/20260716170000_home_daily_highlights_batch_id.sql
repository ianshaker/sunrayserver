-- =============================================================================
-- Пакеты генерации фактов дня (batch_id)
-- Upsert по (highlight_date, slot) перезаписывал text/bot_comment, оставляя
-- тот же id → ответы менеджеров «прилипали» к новой истории.
-- Теперь каждая генерация — новый batch_id + INSERT (старые строки и replies
-- остаются для архива). CRM показывает только последний batch за дату.
-- =============================================================================

ALTER TABLE public.home_daily_highlights
    ADD COLUMN IF NOT EXISTS batch_id uuid;

-- Старые строки одного дня = один общий batch (чтобы CRM не рвала набор слотов)
UPDATE public.home_daily_highlights AS h
SET batch_id = g.bid
FROM (
    SELECT highlight_date, gen_random_uuid() AS bid
    FROM public.home_daily_highlights
    WHERE batch_id IS NULL
    GROUP BY highlight_date
) AS g
WHERE h.highlight_date = g.highlight_date
  AND h.batch_id IS NULL;

ALTER TABLE public.home_daily_highlights
    ALTER COLUMN batch_id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN batch_id SET NOT NULL;

COMMENT ON COLUMN public.home_daily_highlights.batch_id IS
    'UUID одного прогона генерации; CRM берёт последний batch за highlight_date';

-- Больше не уникальны date+slot: можно хранить историю перегенераций
ALTER TABLE public.home_daily_highlights
    DROP CONSTRAINT IF EXISTS home_daily_highlights_date_slot_unique;

-- Внутри одного batch слот уникален
CREATE UNIQUE INDEX IF NOT EXISTS home_daily_highlights_batch_slot_unique
    ON public.home_daily_highlights (batch_id, slot);

CREATE INDEX IF NOT EXISTS idx_home_daily_highlights_date_batch
    ON public.home_daily_highlights (highlight_date DESC, batch_id);
