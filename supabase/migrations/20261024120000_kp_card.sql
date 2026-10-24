-- ============================================================================
-- Каталог КП: «карточка характеристик» системы для листа КП — первая партия Amigo (MINI и
-- Горизонтальные 50).
--
-- Зачем: лист КП вместо сплошного текста сайта завода печатает для каждой системы «карточку»:
-- одно главное фото, мелкая схема (если есть), одна строка описания и табличка из 7 строк
-- «параметр — значение». Тексты подготовлены 24.10.2026 по заданию Яна, формулировки не править;
-- числа с «мм» записаны обычным пробелом — неразрывный пробел вставляет вёрстка листа.
--
-- Что делает:
--   1. kp_systems.card_text — одна строка описания для карточки (длинный description остаётся
--      как есть и в лист не идёт);
--   2. kp_system_specs.kind — к значениям param / bullet / note добавляется card: строка карточки.
--      Такие строки лежат во вкладке и группе «Карточка», по 7 на систему, sort 1..7;
--   3. данные первой партии: 14 строк card (по 7 на MINI и Горизонтальные 50) и card_text двух систем.
--
-- Что НЕ делает: ничего не удаляет; прочие строки kp_system_specs (419 на 24.10.2026) и все
-- остальные системы не трогает; в kp_files ничего не пишет (там 0 строк, а файлов в бакете
-- kp-catalog ещё нет) — три строки kp_files см. закомментированный блок в конце файла.
--
-- Применять точечно (db push нельзя, см. .cursor/rules/supabase-migrations.mdc):
--   supabase db query --linked --workdir sunrayserver-main -f supabase/migrations/20261024120000_kp_card.sql
-- Миграция идемпотентна: повторный запуск ничего не ломает и возвращает карточки на место.
--
-- ВНИМАНИЕ 1: парсер Amigo (PLANS/CRM/22-kp-polnocennye/parser/amigo/vyhod/zapis_amigo.sql) перед
-- записью делает DELETE всех kp_system_specs завода Amigo — его повторный запуск сотрёт и строки
-- card. После такого запуска эту миграцию нужно прогнать ещё раз (card_text парсер не трогает).
-- ВНИМАНИЕ 2: по коду CRM (.work3/kp-companies, kpCatalogService.rowToSpec) неизвестный kind
-- превращается в 'note', а fetchSystemSpecs читает ВСЕ строки системы без отбора по kind: пока
-- 'card' не добавлен в KINDS и не отсеян в списках, строки карточки покажутся там абзацами
-- вкладки «Карточка».
--
-- Откат: DELETE FROM public.kp_system_specs WHERE kind = 'card'; затем вернуть ограничение
-- kind IN ('param', 'bullet', 'note') и ALTER TABLE public.kp_systems DROP COLUMN card_text.
-- ============================================================================

BEGIN;

-- 1. Строка описания для карточки ---------------------------------------------

ALTER TABLE public.kp_systems
  ADD COLUMN IF NOT EXISTS card_text text;

COMMENT ON COLUMN public.kp_systems.card_text IS
  'Одна строка описания системы для карточки на листе КП (над табличкой характеристик). Пусто — карточки у системы нет';

-- 2. Новый вид строки kp_system_specs: card ------------------------------------
-- Имя ограничения не угадано: оно задано явно в миграции 20261023093000 и сверено с pg_constraint
-- боевой базы 24.10.2026 (kp_system_specs_kind_check: kind IN ('param', 'bullet', 'note')).

ALTER TABLE public.kp_system_specs
  DROP CONSTRAINT IF EXISTS kp_system_specs_kind_check;
ALTER TABLE public.kp_system_specs
  ADD CONSTRAINT kp_system_specs_kind_check CHECK (kind IN ('param', 'bullet', 'note', 'card'));

COMMENT ON COLUMN public.kp_system_specs.kind IS
  'Как показывать: param — «название — значение», bullet — пункт списка без названия, note — абзац-пояснение, card — строка карточки системы для листа КП (вкладка и группа «Карточка», по 7 на систему)';

-- 3. Данные: карточки MINI и Горизонтальные 50 (завод Amigo) ---------------------
-- Строки: «параметр — значение», sort 1..7. group_name одинаков у всех строк карточки, поэтому
-- UNIQUE (system_id, group_name, label) не нарушается: подписи внутри системы не повторяются.

INSERT INTO public.kp_system_specs (system_id, tab, group_name, kind, label, value, sort, show_to_client)
SELECT s.id, 'Карточка', 'Карточка', 'card', v.label, v.value, v.sort, true
  FROM (VALUES
    -- [card-specs-begin]
    ('MINI', 'Окна',              'Вертикальные и поворотно-откидные, угол наклона 0–15°', 1),
    ('MINI', 'Крепление на раму', 'Сверление, на скотч, на накидные кронштейны', 2),
    ('MINI', 'Исполнение',        'Свободновисящая, внизу магнитная фиксация или боковая на леску', 3),
    ('MINI', 'Управление',        'Цепь через блок барабанного типа, слева или справа', 4),
    ('MINI', 'Намотка',           'Прямая (рулон виден) или обратная (рулон невидим), фиксация на любом уровне', 5),
    ('MINI', 'Труба',             'Алюминиевая, диаметр 19 мм', 6),
    ('MINI', 'Цвета фурнитуры',   'Белый, коричневый, дуб, тёмно-серый', 7),
    ('Горизонтальные 50', 'Ламели',            'Дерево, бамбук, пластик', 1),
    ('Горизонтальные 50', 'Форма',             'Прямоугольная, трапеция и полутрапеция, круг и полукруг', 2),
    ('Горизонтальные 50', 'Управление',        'Сторона слева или справа, длина веревки — 3/4 высоты изделия или любая (указывается)', 3),
    ('Горизонтальные 50', 'Лесенка',           'Обычная или декоративная (под цвет ламелей)', 4),
    ('Горизонтальные 50', 'Валанс',            'Лицевой (кроме алюминиевых ламелей), угловой — опция', 5),
    ('Горизонтальные 50', 'Карнизы',           'Верхний стальной, нижний по материалу ламелей', 6),
    ('Горизонтальные 50', 'Комплект поставки', 'Изделие, лицевой валанс, кронштейны, инструкция по установке, гарантийный талон', 7)
    -- [card-specs-end]
  ) AS v(code, label, value, sort),
  public.kp_factories f,
  public.kp_systems s
 WHERE lower(f.name) = 'amigo'
   AND s.factory_id = f.id
   AND s.code = v.code
ON CONFLICT (system_id, group_name, label) DO UPDATE
  SET tab            = EXCLUDED.tab,
      kind           = EXCLUDED.kind,
      value          = EXCLUDED.value,
      sort           = EXCLUDED.sort,
      show_to_client = EXCLUDED.show_to_client;

UPDATE public.kp_systems s
   SET card_text = v.card_text
  FROM (VALUES
    -- [card-text-begin]
    ('MINI',              'Компактная модель рулонных штор для установки на раму окна.'),
    ('Горизонтальные 50', 'Свободновисящие горизонтальные жалюзи 50 мм для установки снаружи или внутри проёма.')
    -- [card-text-end]
  ) AS v(code, card_text)
  JOIN public.kp_factories f ON lower(f.name) = 'amigo'
 WHERE s.factory_id = f.id
   AND s.code = v.code;

-- 4. Проверка: при несовпадении — RAISE EXCEPTION и откат всей транзакции ---------

DO $$
DECLARE
  n_card integer;
  n_text integer;
BEGIN
  SELECT count(*) INTO n_card
    FROM public.kp_system_specs p
    JOIN public.kp_systems s ON s.id = p.system_id
    JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo'
     AND s.code IN ('MINI', 'Горизонтальные 50')
     AND p.kind = 'card' AND p.tab = 'Карточка' AND p.group_name = 'Карточка'
     AND p.show_to_client AND p.sort BETWEEN 1 AND 7;
  SELECT count(*) INTO n_text
    FROM public.kp_systems s
    JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo'
     AND s.code IN ('MINI', 'Горизонтальные 50')
     AND s.card_text IS NOT NULL AND s.card_text <> '';
  IF n_card <> 14 THEN
    RAISE EXCEPTION 'kp_card: строк карточки % вместо 14', n_card;
  END IF;
  IF n_text <> 2 THEN
    RAISE EXCEPTION 'kp_card: систем с card_text % вместо 2', n_text;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- 5. ФАЙЛЫ КАРТОЧЕК — НЕ ВЫПОЛНЯЕТСЯ в этой миграции (всё ниже закомментировано).
--
-- Выполнить ОТДЕЛЬНО, после того как три файла из
-- PLANS/CRM/22-kp-polnocennye/foto/amigo-partiya-1/gotovo/ загружены в закрытый бакет kp-catalog
-- (storage_path — путь внутри бакета, без имени бакета):
--   mini-main.webp   -> amigo/mini/main.webp    (900×600, 14078 байт)
--   mini-scheme.webp -> amigo/mini/scheme.webp  (480×656, 5040 байт, прозрачный фон)
--   gor50-main.webp  -> amigo/gor50/main.webp   (900×600, 100988 байт)
--
-- kind — из ограничения kp_files_kind_check: photo, scheme, swatch, pdf. Подходят photo (главное
-- фото) и scheme (схема); новых значений не нужно. sort 0 у всех: «главное» — наименьший sort
-- среди kind = 'photo' данной системы (остальные фото галереи получат 1, 2, …).
-- source_url — исходный адрес на amigo.ru (для схемы — SVG, из которого сделан растр).
-- bytes — размер файла в бакете (gotovo/manifest.json). Повторный запуск обновляет строки.
--
-- INSERT INTO public.kp_files (system_id, kind, title, storage_path, source_url, bytes, sort, show_to_client)
-- SELECT s.id, v.kind, v.title, v.storage_path, v.source_url, v.bytes, v.sort, true
--   FROM (VALUES
--     ('MINI', 'photo',  'MINI — главное фото', 'amigo/mini/main.webp',
--      'https://amigo.ru/upload/iblock/dfe/dfeb955ca834c181bd8e602d2aae22fc.jpg', 14078, 0),
--     ('MINI', 'scheme', 'MINI — схема системы', 'amigo/mini/scheme.webp',
--      'https://amigo.ru/upload/medialibrary/MINI.svg', 5040, 0),
--     ('Горизонтальные 50', 'photo', 'Горизонтальные 50 — главное фото', 'amigo/gor50/main.webp',
--      'https://amigo.ru/upload/iblock/1e2/dwmokvt5wr1wt5jlxi6izfiwhz7e2r1k.jpg', 100988, 0)
--   ) AS v(code, kind, title, storage_path, source_url, bytes, sort),
--   public.kp_factories f,
--   public.kp_systems s
--  WHERE lower(f.name) = 'amigo'
--    AND s.factory_id = f.id
--    AND s.code = v.code
-- ON CONFLICT (storage_path) WHERE storage_path IS NOT NULL DO UPDATE
--   SET system_id = EXCLUDED.system_id, kind = EXCLUDED.kind, title = EXCLUDED.title,
--       source_url = EXCLUDED.source_url, bytes = EXCLUDED.bytes, sort = EXCLUDED.sort;
-- ============================================================================
