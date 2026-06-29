-- CRM (superadmin): управление реестром telegram_bot_chats.

DROP POLICY IF EXISTS telegram_bot_chats_superadmin_write ON public.telegram_bot_chats;

CREATE POLICY telegram_bot_chats_superadmin_write
  ON public.telegram_bot_chats
  FOR ALL
  TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin'
  )
  WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'superadmin'
  );
