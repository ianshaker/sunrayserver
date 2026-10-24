-- ============================================================================
-- Каталог КП: два главных фото карточек (первая партия Amigo). Файлы лежат в закрытом бакете kp-catalog
-- (загружены 24.10.2026 командой supabase storage cp, пути ниже), здесь — только записи о них.
-- Схему MINI не пишем: её заменит своя SVG-схема в едином стиле (слово Яна 24.10.2026).
-- Кадр у обоих фото готовится при подготовке файла: 4:3, 800×600, WebP q78 (у деревянных жалюзи — крупно по ламелям).
-- Идемпотентна: повторный запуск обновляет строки (ON CONFLICT по storage_path).
-- Откат: DELETE FROM public.kp_files WHERE storage_path IN ('amigo/mini/main.webp', 'amigo/gor50/main.webp');
-- ============================================================================

BEGIN;

INSERT INTO public.kp_files (system_id, kind, title, storage_path, source_url, bytes, sort, show_to_client)
SELECT s.id, v.kind, v.title, v.storage_path, v.source_url, v.bytes, v.sort, true
  FROM (VALUES
    ('MINI', 'photo', 'MINI — главное фото', 'amigo/mini/main.webp',
     'https://amigo.ru/upload/iblock/dfe/dfeb955ca834c181bd8e602d2aae22fc.jpg', 12958, 0),
    ('Горизонтальные 50', 'photo', 'Горизонтальные 50 — главное фото', 'amigo/gor50/main.webp',
     'https://amigo.ru/upload/iblock/1e2/dwmokvt5wr1wt5jlxi6izfiwhz7e2r1k.jpg', 78692, 0)
  ) AS v(code, kind, title, storage_path, source_url, bytes, sort),
  public.kp_factories f,
  public.kp_systems s
 WHERE lower(f.name) = 'amigo'
   AND s.factory_id = f.id
   AND s.code = v.code
ON CONFLICT (storage_path) WHERE storage_path IS NOT NULL DO UPDATE
  SET system_id = EXCLUDED.system_id, kind = EXCLUDED.kind, title = EXCLUDED.title,
      source_url = EXCLUDED.source_url, bytes = EXCLUDED.bytes, sort = EXCLUDED.sort;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.kp_files WHERE storage_path IN ('amigo/mini/main.webp', 'amigo/gor50/main.webp');
  IF n <> 2 THEN RAISE EXCEPTION 'kp_card_files: записей о фото % вместо 2', n; END IF;
END $$;

COMMIT;
