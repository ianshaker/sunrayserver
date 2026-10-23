-- ============================================================================
-- Каталог КП: допустимое крепление у каждой системы (kp_systems.mounts).
--
-- Зачем: в «Добавить позицию» менеджеру предлагается только то крепление, которое возможно у
-- выбранной системы (слово Яна 23.10.2026: «крепление на стену, на потолок или на раму —
-- зависит исключительно от системы; вертикальные жалюзи могут крепиться или нет»).
-- Значения: frame — на раму (створку окна), wall — на стену или в проём, ceiling — на потолок.
-- Пустой массив — крепление не выбирается (у системы оно не подходит под три варианта или пока неизвестно).
--
-- Откуда значения для 34 систем Amigo: СТАРТОВАЯ РАСКЛАДКА, составленная по названиям завода
-- («для пластиковых окон» — на раму; «для закрытия проёмов» — стена и потолок) и по текстам
-- страниц сайта (парсер: PLANS/CRM/22-kp-polnocennye/parser/amigo). Она НЕ взята из таблицы завода:
-- на сайте крепление написано свободным текстом по-разному. Нужна проверка менеджерами; править —
-- обычным UPDATE kp_systems SET mounts = …. Колонка в запись парсера (zapis_amigo.sql) не входит:
-- повторный запуск парсера её не затирает.
-- ============================================================================

BEGIN;

ALTER TABLE public.kp_systems
  ADD COLUMN IF NOT EXISTS mounts text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.kp_systems
  DROP CONSTRAINT IF EXISTS kp_systems_mounts_check;
ALTER TABLE public.kp_systems
  ADD CONSTRAINT kp_systems_mounts_check CHECK (mounts <@ ARRAY['frame', 'wall', 'ceiling']::text[]);

COMMENT ON COLUMN public.kp_systems.mounts IS
  'Какое крепление возможно: frame — на раму, wall — на стену или в проём, ceiling — на потолок. Пусто — не выбирается';

UPDATE public.kp_systems s
   SET mounts = v.mounts
  FROM (VALUES
    ('ROOF',                      ARRAY['frame']),
    ('MINI',                      ARRAY['frame']),
    ('UNI1',                      ARRAY['frame']),
    ('ROLLA',                     ARRAY['frame']),
    ('UNI2',                      ARRAY['frame']),
    ('BNT',                       ARRAY['wall', 'ceiling']),
    ('AMG',                       ARRAY['wall', 'ceiling']),
    ('MG',                        ARRAY['wall', 'ceiling']),
    ('MINI-ЗЕБРА',                ARRAY['frame']),
    ('UNI1-ЗЕБРА',                ARRAY['frame']),
    ('ЗЕБРА BNT',                 ARRAY['wall', 'ceiling']),
    ('ЗЕБРА MGS',                 ARRAY['wall', 'ceiling']),
    ('Вертикальные тканевые',     ARRAY['wall', 'ceiling']),
    ('Вертикальные Бриз',         ARRAY['wall', 'ceiling']),
    ('Вертикальные пластиковые',  ARRAY['wall', 'ceiling']),
    ('Вертикальные алюминиевые',  ARRAY['wall', 'ceiling']),
    ('Вертикальные мультифактура', ARRAY['wall', 'ceiling']),
    ('VENUS 16/25',               ARRAY['frame']),
    ('Межрамные',                 ARRAY[]::text[]),
    ('Алюминиевые 16/25',         ARRAY['frame', 'wall', 'ceiling']),
    ('Алюминиевые 50',            ARRAY['wall', 'ceiling']),
    ('Кассетные 25',              ARRAY['frame']),
    ('Горизонтальные 25',         ARRAY['frame', 'wall', 'ceiling']),
    ('Горизонтальные 50',         ARRAY['wall', 'ceiling']),
    ('Плиссе MINI',               ARRAY['frame']),
    ('Плиссе RUS',                ARRAY['frame', 'wall', 'ceiling']),
    ('Плиссе MIDI',               ARRAY['frame', 'wall', 'ceiling']),
    ('Плиссе MAXI',               ARRAY['wall', 'ceiling']),
    ('Плиссе сложные формы',      ARRAY['frame', 'wall', 'ceiling']),
    ('Римские MINI',              ARRAY['wall', 'ceiling']),
    ('Римские MIDI',              ARRAY['wall', 'ceiling']),
    ('Римские MAXI',              ARRAY['wall', 'ceiling']),
    ('Римские ДЕНЬ-НОЧЬ',         ARRAY['wall', 'ceiling']),
    ('Римские наклонные MIDI',    ARRAY['wall', 'ceiling'])
  ) AS v(code, mounts)
  JOIN public.kp_factories f ON lower(f.name) = 'amigo'
 WHERE s.factory_id = f.id
   AND lower(s.code) = lower(v.code);

DO $$
DECLARE
  n_all   integer;
  n_empty integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE s.mounts = '{}')
    INTO n_all, n_empty
    FROM public.kp_systems s
    JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo';
  IF n_all <> 34 THEN
    RAISE EXCEPTION 'kp_systems_mounts: систем Amigo % вместо 34', n_all;
  END IF;
  IF n_empty <> 1 THEN
    RAISE EXCEPTION 'kp_systems_mounts: систем без крепления % вместо 1 (Межрамные)', n_empty;
  END IF;
END $$;

COMMIT;
