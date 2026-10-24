-- ============================================================================
-- Каталог КП: две свои схемы систем (первая партия Amigo) — SVG, нарисованные у нас в едином стиле
-- (слово Яна 24.10.2026: «для всех отрисовывал бы свои SVG, акцент на механизме»). Файлы лежат в закрытом
-- бакете kp-catalog (amigo/mini/scheme.svg, amigo/gor50/scheme.svg), здесь — записи о них. Заводские схемы
-- не используются: источника на сайте нет (source_url пуст), рисунок — наш.
-- Идемпотентна: повторный запуск обновляет строки (ON CONFLICT по storage_path).
-- Откат: DELETE FROM public.kp_files WHERE storage_path IN ('amigo/mini/scheme.svg', 'amigo/gor50/scheme.svg');
-- ============================================================================

BEGIN;

INSERT INTO public.kp_files (system_id, kind, title, storage_path, source_url, bytes, sort, show_to_client)
SELECT s.id, 'scheme', v.title, v.storage_path, NULL, v.bytes, 0, true
  FROM (VALUES
    ('MINI', 'MINI — схема системы (наша)', 'amigo/mini/scheme.svg', 1480),
    ('Горизонтальные 50', 'Горизонтальные 50 — схема системы (наша)', 'amigo/gor50/scheme.svg', 2589)
  ) AS v(code, title, storage_path, bytes),
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
  SELECT count(*) INTO n FROM public.kp_files WHERE kind = 'scheme' AND storage_path IN ('amigo/mini/scheme.svg', 'amigo/gor50/scheme.svg');
  IF n <> 2 THEN RAISE EXCEPTION 'kp_card_schemes: записей о схемах % вместо 2', n; END IF;
END $$;

COMMIT;
