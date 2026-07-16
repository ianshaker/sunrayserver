-- dogovornew.status — свободный text, без enum.
-- Снимаем legacy CHECK (если был), чтобы статус «Черновик» сохранялся без ошибок.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'dogovornew_status_check'
      AND conrelid = 'public.dogovornew'::regclass
  ) THEN
    ALTER TABLE public.dogovornew DROP CONSTRAINT dogovornew_status_check;
  END IF;
END $$;

COMMENT ON COLUMN public.dogovornew.status IS
  'Статус: Черновик | Новый | Ожидаем счет | Ожидаем оплату | В работе | Монтаж частично | Монтаж полный | Завершен | Отменен';
