-- Публичный ключ (роль anon) больше ничего не читает, не пишет и не вызывает в схеме public.
-- Слово Яна 17.10.2026: «ну давай ток прошу внимательно» — на «удали функцию create_admin и закрой таблицы базы SUNRAY от публичного ключа».
-- План и опись — PLANS/SERVER/README.md («Открытые находки», 17.10), PLANS/PROXY/02-zashchita-servera/README.md.
-- Кто не задет: CRM обращается к таблицам только после входа (роль authenticated — её права не меняются, это проверяет шаг 4);
-- сервер Render — service_role; сайт и прокси 2.0 в базу не ходят.
-- Откат — точно по снимку прав «до»: PLANS/PROXY/02-zashchita-servera/prava-do-zakrytiya-2026-10-17.json
-- (relacl/proacl/defacl на 17.10 15:57 МСК); откат — PLANS/PROXY/02-zashchita-servera/otkat-anon-zakryt-public.sql (вне папки
-- миграций, чтобы его не приняли за миграцию). Сухой прогон «закрыть → откатить» 17.10: расхождений с «до» 0.

BEGIN;

-- Права authenticated до правки — шаг 4 сверит, что они не изменились.
CREATE TEMP TABLE auth_do ON COMMIT DROP AS
SELECT c.oid, c.relname,
       substring(coalesce(c.relacl::text, '') from 'authenticated=([a-zA-Z*]*)/') AS prava
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f','S');

CREATE TEMP TABLE auth_f_do ON COMMIT DROP AS
SELECT p.oid, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS mozhet,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS mozhet_sr
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public';

-- 1. Таблицы, представления, последовательности: у anon — ничего.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 2. Функции SECURITY DEFINER (обходят RLS): anon не вызывает. EXECUTE мог прийти через PUBLIC — сперва явно сохраняем
--    его authenticated и service_role, у кого он есть сейчас, потом снимаем у PUBLIC и anon. Функции расширений не трогаем.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    IF has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

-- 3. Новые таблицы и функции, которые создаст postgres (миграции, Lovable), anon больше не получает.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 4. Страховка: что-то не так — вся миграция откатывается.
DO $$
DECLARE n_t int; n_s int; n_f int; n_auth int; n_auth_f int;
BEGIN
  SELECT count(*) INTO n_t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f')
     AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  SELECT count(*) INTO n_s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE CASE WHEN n.nspname = 'public' AND c.relkind = 'S'
              THEN has_sequence_privilege('anon', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END;  -- CASE: сначала вид, потом проверка
  SELECT count(*) INTO n_f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  SELECT count(*) INTO n_auth FROM auth_do a JOIN pg_class c ON c.oid = a.oid
   WHERE a.prava IS DISTINCT FROM substring(coalesce(c.relacl::text, '') from 'authenticated=([a-zA-Z*]*)/');
  SELECT count(*) INTO n_auth_f FROM auth_f_do a
   WHERE a.mozhet IS DISTINCT FROM has_function_privilege('authenticated', a.oid, 'EXECUTE')
      OR a.mozhet_sr IS DISTINCT FROM has_function_privilege('service_role', a.oid, 'EXECUTE');
  IF n_t + n_s + n_f + n_auth + n_auth_f > 0 THEN
    RAISE EXCEPTION 'Отмена: у anon осталось таблиц %, последовательностей %, функций %; у authenticated/service_role изменилось таблиц %, функций %',
      n_t, n_s, n_f, n_auth, n_auth_f;
  END IF;
END $$;

COMMIT;
