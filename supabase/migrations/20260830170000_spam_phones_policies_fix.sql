-- ============================================================================
-- Правки прав на spam_phones: политики были только для роли anon, а CRM у
-- вошедшего пользователя ходит как authenticated. Кнопка «Спам» падала с
-- «new row violates row-level security policy for table spam_phones».
--
-- Делаем как у таблицы appeals — политики для всех ролей.
-- ============================================================================

DROP POLICY IF EXISTS "anon select spam phones" ON public.spam_phones;
DROP POLICY IF EXISTS "anon insert spam phones" ON public.spam_phones;
DROP POLICY IF EXISTS "anon update spam phones" ON public.spam_phones;
DROP POLICY IF EXISTS "anon delete spam phones" ON public.spam_phones;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spam_phones TO anon, authenticated;

CREATE POLICY "Разрешить чтение спам-номеров всем" ON public.spam_phones
  FOR SELECT USING (true);

CREATE POLICY "Разрешить добавление спам-номеров всем" ON public.spam_phones
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Разрешить обновление спам-номеров всем" ON public.spam_phones
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Разрешить удаление спам-номеров всем" ON public.spam_phones
  FOR DELETE USING (true);
