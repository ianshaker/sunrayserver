-- ============================================================================
-- Каталог КП: характеристики систем — вкладка сайта, вид строки, уникальность по группе.
--
-- Зачем: данные Amigo (первый заход, 34 системы) записываются так, чтобы их можно было
-- переиспользовать в КП и в модуляторе КП (слово Яна 23.10.2026: «грамотно записывать по
-- параметрам, чтобы потом переиспользовать»):
--   tab  — вкладка сайта завода (Описание, Опции, Замер и монтаж…). «Опции» — то, что
--          менеджер выбирает при заказе, остальное — описание и правила монтажа;
--   kind — как показывать строку: param (параметр «название — значение»), bullet (пункт
--          списка без названия), note (абзац-пояснение);
--   уникальность строки — теперь (система, группа, название), а не (система, название):
--          у разных групп бывают одноимённые «Характеристика 1».
--
-- Таблица kp_system_specs создана миграцией 20261023083000_kp_catalog.sql и пуста; миграция
-- откажется работать, если в ней уже есть строки. Откат: убрать колонки tab и kind, вернуть
-- ограничение kp_system_specs_system_label_key и NULL в group_name.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kp_system_specs) THEN
    RAISE EXCEPTION 'kp_system_specs не пуста: миграция рассчитана на пустую таблицу';
  END IF;
END $$;

ALTER TABLE public.kp_system_specs
  ADD COLUMN IF NOT EXISTS tab  text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'param';

ALTER TABLE public.kp_system_specs
  DROP CONSTRAINT IF EXISTS kp_system_specs_kind_check;
ALTER TABLE public.kp_system_specs
  ADD CONSTRAINT kp_system_specs_kind_check CHECK (kind IN ('param', 'bullet', 'note'));

ALTER TABLE public.kp_system_specs
  ALTER COLUMN group_name SET DEFAULT '',
  ALTER COLUMN group_name SET NOT NULL;

ALTER TABLE public.kp_system_specs
  DROP CONSTRAINT IF EXISTS kp_system_specs_system_label_key;
ALTER TABLE public.kp_system_specs
  ADD CONSTRAINT kp_system_specs_system_group_label_key UNIQUE (system_id, group_name, label);

COMMENT ON COLUMN public.kp_system_specs.tab IS
  'Вкладка сайта завода: Описание, Опции, Замер и монтаж, Дополнительно… «Опции» — выбираемые при заказе';
COMMENT ON COLUMN public.kp_system_specs.kind IS
  'Как показывать: param — «название — значение», bullet — пункт списка без названия, note — абзац-пояснение';
COMMENT ON COLUMN public.kp_system_specs.group_name IS
  'Группа в КП: заголовок раздела завода (Характеристики системы MINI, Комплект поставки…) или название вкладки';

COMMIT;
