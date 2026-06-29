-- Доступ к токену Gmail через публичный anon-ключ (как остальной postamails и mango_calls).
-- ВНИМАНИЕ: anon-ключ публичный → строку токена сможет прочитать любой, у кого есть anon-ключ.
-- Это сознательный компромисс ради простоты (readonly-доступ к ящику заявок).

GRANT SELECT, INSERT, UPDATE ON public.gmail_oauth_tokens TO anon;

DROP POLICY IF EXISTS "anon select gmail token" ON public.gmail_oauth_tokens;
CREATE POLICY "anon select gmail token" ON public.gmail_oauth_tokens
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon insert gmail token" ON public.gmail_oauth_tokens;
CREATE POLICY "anon insert gmail token" ON public.gmail_oauth_tokens
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon update gmail token" ON public.gmail_oauth_tokens;
CREATE POLICY "anon update gmail token" ON public.gmail_oauth_tokens
  FOR UPDATE TO anon USING (true) WITH CHECK (true);
