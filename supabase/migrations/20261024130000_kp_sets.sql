-- ============================================================================
-- КП для компаний: главная таблица kp_sets — комплект КП по обращению (по образцу public.estimates,
-- PLANS/CRM/22-kp-polnocennye/01-model-dannykh.md §2.1 и §5).
--
-- Зачем: до сих пор комплекты КП жили только в памяти страницы (демо-заготовки в коде), и
-- посмотреть образцовое КП вживую было негде. Таблица даёт место для комплектов и для образцов
-- «ТЕСТ — все возможности КП» (их записывает отдельный файл 20261024131000_kp_sets_sample.sql).
--
-- Что делает: создаёт public.kp_sets (19 колонок), уникальность (appeal_id, version) как у сметы,
-- индексы, триггер updated_at (общая функция set_updated_at(), её же берёт каталог КП), RLS как у
-- каталога КП: authenticated — всё, anon — ничего, сервер печати на Render (service_role) обходит RLS.
-- Заказчик лежит и в колонках (company_name, contact_*) — для списка и поиска, и в payload — для листа;
-- позиции, условия, юрлица и правила цен партнёров — только в payload (форма — типы CRM `KpSet`,
-- kp-companies/types/kp.types.ts). Колонки плана, которых типы КП ещё не выражают (company_inn,
-- company_kind, with_partners, customer_aware, customer_note, variants_count, issued_at), не заведены:
-- добавятся ALTER TABLE … ADD COLUMN IF NOT EXISTS, когда в них появится смысл.
--
-- Что НЕ делает: не трогает estimates и каталог kp_*; данных не пишет (образцы — следующий файл).
--
-- Применять точечно (db push нельзя, см. .cursor/rules/supabase-migrations.mdc):
--   supabase db query --linked --workdir sunrayserver-main -f supabase/migrations/20261024130000_kp_sets.sql
-- Снимок «до»: select to_regclass('public.kp_sets');  — NULL. «После»: select count(*) from public.kp_sets;  — 0.
-- Миграция идемпотентна: повторный запуск ничего не ломает.
--
-- Откат (таблица новая, зависимостей от неё нет): DROP TABLE public.kp_sets;
-- (общую функцию set_updated_at() не трогать — её используют другие таблицы).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.kp_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appeal_id       text NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  title           text NOT NULL,
  is_custom_memo  boolean NOT NULL DEFAULT false,
  company_name    text,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  status          text NOT NULL DEFAULT 'draft',
  own_total       numeric(12, 2),
  payload         jsonb NOT NULL,
  is_archived     boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users (id),
  created_by_name text,
  updated_by      uuid REFERENCES auth.users (id),
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kp_sets_appeal_version_unique UNIQUE (appeal_id, version),
  CONSTRAINT kp_sets_status_check CHECK (status IN ('draft', 'ready', 'issued', 'accepted', 'rejected', 'expired'))
);

COMMENT ON TABLE public.kp_sets IS
  'Комплекты КП для компаний из генератора КП. На одно обращение — несколько независимых комплектов (version), как сметы в estimates';
COMMENT ON COLUMN public.kp_sets.appeal_id IS
  'ID обращения с решёткой (#010312) или текст памятки, если is_custom_memo = true — как в estimates';
COMMENT ON COLUMN public.kp_sets.title IS
  'Формат как у сметы: #010312 - 1 - 24.10.2026';
COMMENT ON COLUMN public.kp_sets.own_total IS
  'Итог нашего КП, ₽ — для списка; считается кодом CRM при записи, в образцах — по цене позиций';
COMMENT ON COLUMN public.kp_sets.payload IS
  'JSON: version (число), customer, positions, conditions, issuers, rules — форма типа KpSet (kp-companies/types/kp.types.ts); схема и план — 01-model-dannykh.md §2.2';

CREATE INDEX IF NOT EXISTS idx_kp_sets_updated_at  ON public.kp_sets (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_kp_sets_created_by  ON public.kp_sets (created_by);
CREATE INDEX IF NOT EXISTS idx_kp_sets_is_archived ON public.kp_sets (is_archived);
CREATE INDEX IF NOT EXISTS idx_kp_sets_status      ON public.kp_sets (status);

DROP TRIGGER IF EXISTS trg_kp_sets_updated_at ON public.kp_sets;
CREATE TRIGGER trg_kp_sets_updated_at
  BEFORE UPDATE ON public.kp_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Доступ — как у каталога КП (20261023083000_kp_catalog.sql): RLS, authenticated — всё, anon — ничего
ALTER TABLE public.kp_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kp_sets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kp_sets TO authenticated;
DROP POLICY IF EXISTS "Менеджеры CRM: комплекты КП" ON public.kp_sets;
CREATE POLICY "Менеджеры CRM: комплекты КП" ON public.kp_sets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Проверка: при несовпадении — RAISE EXCEPTION и откат всей транзакции
DO $$
DECLARE
  n_cols   integer;
  rls_on   boolean;
  n_pol    integer;
  n_uniq   integer;
  n_trg    integer;
  anon_has boolean := has_table_privilege('anon', 'public.kp_sets', 'SELECT,INSERT,UPDATE,DELETE');
  auth_ok  boolean := has_table_privilege('authenticated', 'public.kp_sets', 'SELECT')
                  AND has_table_privilege('authenticated', 'public.kp_sets', 'INSERT')
                  AND has_table_privilege('authenticated', 'public.kp_sets', 'UPDATE')
                  AND has_table_privilege('authenticated', 'public.kp_sets', 'DELETE');
BEGIN
  SELECT count(*) INTO n_cols FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'kp_sets';
  SELECT relrowsecurity INTO rls_on FROM pg_class WHERE oid = 'public.kp_sets'::regclass;
  SELECT count(*) INTO n_pol FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'kp_sets' AND cmd = 'ALL' AND roles = '{authenticated}'::name[];
  SELECT count(*) INTO n_uniq FROM pg_constraint
   WHERE conrelid = 'public.kp_sets'::regclass AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (appeal_id, version)';
  SELECT count(*) INTO n_trg FROM pg_trigger
   WHERE tgrelid = 'public.kp_sets'::regclass AND tgname = 'trg_kp_sets_updated_at';
  IF n_cols <> 19 OR NOT rls_on OR n_pol <> 1 OR n_uniq <> 1 OR n_trg <> 1 OR anon_has OR NOT auth_ok THEN
    RAISE EXCEPTION 'kp_sets: проверка не пройдена: колонок % (нужно 19), RLS %, политик % (1), UNIQUE % (1), триггеров % (1), anon имеет права %, authenticated полный доступ %',
      n_cols, rls_on, n_pol, n_uniq, n_trg, anon_has, auth_ok;
  END IF;
END $$;

COMMIT;
