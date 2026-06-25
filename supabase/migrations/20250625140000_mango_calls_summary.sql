-- ===========================================================================
-- Вторая ступень обработки звонка: причёсанное саммари диалога (Gemini).
--
-- transcript (сырой текст Google STT) → Gemini Flash → summary (пересказ).
-- Отдельный статус-цикл, не зависит от расшифровки:
--   summary_status: pending → processing → done | failed | skipped
-- ===========================================================================

ALTER TABLE public.mango_calls
    ADD COLUMN IF NOT EXISTS summary text,
    ADD COLUMN IF NOT EXISTS summary_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS summary_model text,
    ADD COLUMN IF NOT EXISTS summary_error text;

COMMENT ON COLUMN public.mango_calls.summary IS 'Причёсанный пересказ диалога от 3-го лица (Gemini)';
COMMENT ON COLUMN public.mango_calls.summary_model IS 'Модель саммари, напр. gemini-2.0-flash';

-- Статусы саммари
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mango_calls_summary_status_check'
    ) THEN
        ALTER TABLE public.mango_calls
            ADD CONSTRAINT mango_calls_summary_status_check CHECK (
                summary_status IN ('pending', 'processing', 'done', 'failed', 'skipped')
            );
    END IF;
END $$;

-- Очередь саммари: расшифровка готова, причёсывания ещё нет
CREATE INDEX IF NOT EXISTS idx_mango_calls_summary_status
    ON public.mango_calls (summary_status)
    WHERE summary_status = 'pending' AND transcript_status = 'done';
