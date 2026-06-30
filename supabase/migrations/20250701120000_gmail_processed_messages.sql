-- ============================================================================
-- Журнал обработанных писем Gmail (postamails).
--
-- Зачем: на Render диск эфемерный — postamailsCache.json терялся при redeploy,
-- и все письма за день обрабатывались заново (спам «уже есть в базе» в TG).
-- message_id из Gmail API уникален и переживает рестарты сервера.
--
-- Доступ: только service_role (сервер Render). Anon/authenticated — без политик.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gmail_processed_messages (
  message_id    TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  outcome       TEXT NOT NULL
    CHECK (outcome IN ('created', 'duplicate', 'contract', 'error')),
  phone         TEXT NULL,
  appeal_number TEXT NULL
);

COMMENT ON TABLE public.gmail_processed_messages IS
  'Postamails: какие Gmail message_id уже обработаны (дедуп после redeploy).';

COMMENT ON COLUMN public.gmail_processed_messages.message_id IS
  'ID сообщения из Gmail API (users.messages.list/get).';

COMMENT ON COLUMN public.gmail_processed_messages.outcome IS
  'created | duplicate | contract | error';

CREATE INDEX IF NOT EXISTS idx_gmail_processed_messages_processed_at
  ON public.gmail_processed_messages (processed_at);

ALTER TABLE public.gmail_processed_messages ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.gmail_processed_messages TO service_role;
