-- =============================================================================
-- Доступ anon-ключа к звонкам и записям
-- Сервер (Render) использует тот же anon-ключ, что и остальной код проекта.
-- service_role НЕ требуется. Если позже положите SUPABASE_SERVICE_ROLE_KEY в env —
-- он будет обходить RLS, и эти политики просто перестанут влиять (вреда нет).
--
-- ВНИМАНИЕ: anon-ключ публичен (он есть во фронте CRM). Эти политики позволяют
-- писать/читать звонки и mp3 любому, у кого есть anon-ключ. Для текущей внутренней
-- схемы проекта это приемлемо (appeals тоже пишутся через anon). Для усиления
-- безопасности позже переведите сервер на service_role и удалите эти политики.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Таблица public.mango_calls
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS mango_calls_anon_select ON public.mango_calls;
CREATE POLICY mango_calls_anon_select
    ON public.mango_calls
    FOR SELECT
    TO anon
    USING (true);

DROP POLICY IF EXISTS mango_calls_anon_insert ON public.mango_calls;
CREATE POLICY mango_calls_anon_insert
    ON public.mango_calls
    FOR INSERT
    TO anon
    WITH CHECK (true);

DROP POLICY IF EXISTS mango_calls_anon_update ON public.mango_calls;
CREATE POLICY mango_calls_anon_update
    ON public.mango_calls
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Storage bucket call-recordings (объекты в storage.objects)
-- upsert при загрузке требует и INSERT, и UPDATE
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS call_recordings_anon_read ON storage.objects;
CREATE POLICY call_recordings_anon_read
    ON storage.objects
    FOR SELECT
    TO anon
    USING (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS call_recordings_anon_insert ON storage.objects;
CREATE POLICY call_recordings_anon_insert
    ON storage.objects
    FOR INSERT
    TO anon
    WITH CHECK (bucket_id = 'call-recordings');

DROP POLICY IF EXISTS call_recordings_anon_update ON storage.objects;
CREATE POLICY call_recordings_anon_update
    ON storage.objects
    FOR UPDATE
    TO anon
    USING (bucket_id = 'call-recordings')
    WITH CHECK (bucket_id = 'call-recordings');
