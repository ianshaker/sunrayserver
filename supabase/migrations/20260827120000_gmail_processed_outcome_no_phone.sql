-- ============================================================================
-- Журнал писем: разрешить исход no_phone и запомнить причину пометки «спам».
--
-- Зачем no_phone: письмо без разобранного номера доставляется в чат текстом,
-- но записывалось словом error — тем же, что и падение базы. Суточная сводка
-- не могла отличить доставленное письмо от настоящего сбоя.
--
-- Зачем spam_reason: чтобы сводка могла посчитать, сколько заявок за сутки
-- ушло с пометкой и по какой причине.
--
-- Строки не удаляются и не переписываются. Другие таблицы не затрагиваются.
-- ============================================================================

-- Прежняя проверка объявлена внутри колонки, имя ей присвоила база.
-- Ищем её по содержимому, а не по угаданному имени.
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
  CHECK (outcome IN ('created', 'duplicate', 'contract', 'error', 'no_phone'));

ALTER TABLE public.gmail_processed_messages
  ADD COLUMN IF NOT EXISTS spam_reason TEXT NULL;

COMMENT ON COLUMN public.gmail_processed_messages.outcome IS
  'created | duplicate | contract | no_phone | error';

COMMENT ON COLUMN public.gmail_processed_messages.spam_reason IS
  'Причины пометки «вероятно спам» через запятую; NULL — заявка без пометки.';
