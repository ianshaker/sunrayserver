-- Отметка об отправке AI-сводки в Telegram (чат входящих).
-- NULL = ещё не отправляли; повторная отправка только если NULL (retry после сбоя).

ALTER TABLE public.mango_calls
    ADD COLUMN IF NOT EXISTS summary_telegram_sent_at timestamptz;

COMMENT ON COLUMN public.mango_calls.summary_telegram_sent_at IS
    'Когда AI-сводка отправлена в Telegram-чат входящих; NULL — не отправлена';

CREATE INDEX IF NOT EXISTS idx_mango_calls_summary_telegram_pending
    ON public.mango_calls (created_at)
    WHERE summary_status = 'done'
      AND summary_telegram_sent_at IS NULL
      AND direction = 1;
