-- ============================================================================
-- Каталог КП: папка brand/ закрытого бакета kp-catalog — только чтение (26.10.2026).
--
-- Зачем: в brand/ лежит печать с подписью нашего ИП (brand/own/stamp.webp): её подкладывает лист КП при «Превью» и «Скачать PDF» (раньше она была вшита в код CRM и открыта
-- без входа — слова Яна 26.10: «надо делать как полагается»). Действующие политики бакета (20261023083000_kp_catalog.sql) дают любому вошедшему пользователю проекта
-- (роль authenticated) читать, добавлять, менять и удалять ЛЮБОЙ файл бакета — значит, печать можно подменить (все PDF уйдут с чужой картинкой) или стереть (все КП без печати).
--
-- Что делает: три ограничивающие (RESTRICTIVE) политики на storage.objects для роли authenticated — добавлять, менять и удалять файлы в brand/ нельзя. Читать — можно, как и остальной каталог.
-- Файлы в brand/ кладёт владелец проекта командой supabase storage cp (она ходит ключом проекта и этих политик не касается). Остальные папки бакета (amigo/ и дальше) — как раньше.
--
-- Что НЕ делает: не трогает действующие политики и файлы; чтение brand/ не меняет.
-- Идемпотентна: повторный запуск пересоздаёт те же политики.
-- Откат: DROP POLICY "Каталог КП: brand/ не добавлять" ON storage.objects; (и так же «не менять», «не удалять»).
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Каталог КП: brand/ не добавлять" ON storage.objects;
CREATE POLICY "Каталог КП: brand/ не добавлять" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (bucket_id = 'kp-catalog' AND name LIKE 'brand/%'));

DROP POLICY IF EXISTS "Каталог КП: brand/ не менять" ON storage.objects;
CREATE POLICY "Каталог КП: brand/ не менять" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (bucket_id = 'kp-catalog' AND name LIKE 'brand/%'))
  WITH CHECK (NOT (bucket_id = 'kp-catalog' AND name LIKE 'brand/%'));

DROP POLICY IF EXISTS "Каталог КП: brand/ не удалять" ON storage.objects;
CREATE POLICY "Каталог КП: brand/ не удалять" ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (bucket_id = 'kp-catalog' AND name LIKE 'brand/%'));

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'RESTRICTIVE'
     AND policyname IN ('Каталог КП: brand/ не добавлять', 'Каталог КП: brand/ не менять', 'Каталог КП: brand/ не удалять');
  IF n <> 3 THEN RAISE EXCEPTION 'kp_catalog_brand_readonly: политик создано % вместо 3', n; END IF;
END $$;

COMMIT;
