-- ============================================================================
-- Каталог КП: названия и описания рулонных систем AMG и MG — убрать то, что сайт завода принёс в базу «как есть» (26.10.2026).
--
-- Зачем: у двух из восьми рулонных систем название набрано заглавными («РУЛОННЫЕ ШТОРЫ AMG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ»), и оно печатается заголовком
-- карточки на листе КП и стоит на плитке выбора рядом с шестью нормальными названиями. В описании MG слово разорвано пробелом («Рулонные ш торы»),
-- в описании AMG первая буква «С» — латинская (код 0x43). Дизайн-взгляд на плитки с иконками (26.10.2026) отметил это как заметное.
--
-- Что делает (только эти 4 значения, каждое — по коду системы завода Amigo и только если прежнее значение совпадает):
--   kp_systems.name  AMG: «РУЛОННЫЕ ШТОРЫ AMG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ» → «Рулонные шторы AMG для закрытия проёмов»
--   kp_systems.name  MG:  «РУЛОННЫЕ ШТОРЫ MG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ»  → «Рулонные шторы MG для закрытия проёмов»
--   kp_systems.description MG:  «Рулонные ш торы …» → «Рулонные шторы …»
--   kp_systems.description AMG: латинская «C» в начале → кириллическая «С»
-- Позиции уже собранных КП хранят свой снимок названия и не меняются; новые позиции возьмут исправленное.
-- Прочие семейства (зебра — «ЗЕБРА» в названиях, вертикальные, плиссе, римские) не трогает: у них отдельный проход.
--
-- Идемпотентна: повторный запуск ничего не меняет (условие WHERE по прежнему значению). Парсер Amigo (parser/amigo/vyhod/zapis_amigo.sql)
-- при повторном запуске вернёт старый текст сайта — тогда эту миграцию прогнать ещё раз.
-- Откат: UPDATE public.kp_systems SET name = 'РУЛОННЫЕ ШТОРЫ AMG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ' WHERE code = 'AMG' (и так же MG); в описании MG
--        «шторы» → «ш торы», у AMG первую «С» вернуть на латинскую «C».
-- ============================================================================

BEGIN;

UPDATE public.kp_systems s
   SET name = 'Рулонные шторы AMG для закрытия проёмов'
  FROM public.kp_factories f
 WHERE lower(f.name) = 'amigo' AND s.factory_id = f.id
   AND s.code = 'AMG' AND s.name = 'РУЛОННЫЕ ШТОРЫ AMG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ';

UPDATE public.kp_systems s
   SET name = 'Рулонные шторы MG для закрытия проёмов'
  FROM public.kp_factories f
 WHERE lower(f.name) = 'amigo' AND s.factory_id = f.id
   AND s.code = 'MG' AND s.name = 'РУЛОННЫЕ ШТОРЫ MG ДЛЯ ЗАКРЫТИЯ ПРОЁМОВ';

UPDATE public.kp_systems s
   SET description = replace(s.description, 'Рулонные ш торы', 'Рулонные шторы')
  FROM public.kp_factories f
 WHERE lower(f.name) = 'amigo' AND s.factory_id = f.id
   AND s.code = 'MG' AND position('Рулонные ш торы' in s.description) > 0;

UPDATE public.kp_systems s
   SET description = 'С' || substr(s.description, 2)
  FROM public.kp_factories f
 WHERE lower(f.name) = 'amigo' AND s.factory_id = f.id
   AND s.code = 'AMG' AND substr(s.description, 1, 1) = 'C' AND substr(s.description, 2, 6) = 'истема';

DO $$
DECLARE
  n_name integer;
  n_desc integer;
BEGIN
  SELECT count(*) INTO n_name
    FROM public.kp_systems s JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo'
     AND ((s.code = 'AMG' AND s.name = 'Рулонные шторы AMG для закрытия проёмов')
       OR (s.code = 'MG' AND s.name = 'Рулонные шторы MG для закрытия проёмов'));
  SELECT count(*) INTO n_desc
    FROM public.kp_systems s JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo'
     AND ((s.code = 'MG' AND position('ш торы' in s.description) = 0 AND s.description LIKE 'Рулонные шторы Классика MG%')
       OR (s.code = 'AMG' AND s.description LIKE 'Система рулонных штор AMG%'));
  IF n_name <> 2 THEN RAISE EXCEPTION 'kp_rulon_names_fix: названий исправлено % вместо 2', n_name; END IF;
  IF n_desc <> 2 THEN RAISE EXCEPTION 'kp_rulon_names_fix: описаний исправлено % вместо 2', n_desc; END IF;
END $$;

COMMIT;
