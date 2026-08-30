-- ============================================================================
-- Журнал писем: разрешить исход blacklisted.
--
-- Письмо с номером из чёрного списка не заводит заявку и не идёт в чат, но
-- запись в журнале остаётся — иначе след теряется, а это запрещено.
-- Отдельный исход нужен, чтобы в суточной сводке отбитое списком не смешивалось
-- со сбоями разбора.
--
-- Строки не удаляются и не переписываются.
-- ============================================================================

DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.gmail_processed_messages'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%outcome%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.gmail_processed_messages DROP CONSTRAINT %I',
      con_name
    );
  END LOOP;
END $$;

ALTER TABLE public.gmail_processed_messages
  ADD CONSTRAINT gmail_processed_messages_outcome_check
  CHECK (outcome IN ('created', 'duplicate', 'contract', 'error', 'no_phone', 'blacklisted'));

COMMENT ON COLUMN public.gmail_processed_messages.outcome IS
  'created | duplicate | contract | no_phone | blacklisted | error';
