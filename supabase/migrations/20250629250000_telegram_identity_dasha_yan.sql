-- Догоняем Telegram-привязку после создания аккаунта Дарьи в Auth.
--
-- Проверено в Supabase (2026-06-29):
--   id    = 2007764e-dae6-48e6-8a77-8978b00a3680
--   email = zhalyuzi-sunray@yandex.ru
--   role  = user (как у остальных менеджеров)
--   full_name был пустой — проставляем ниже.

-- Ян Шейкер (@Sunsseo)
UPDATE public.profiles SET telegram_username = 'sunsseo'
  WHERE id = '28906cb8-fb15-40d1-9a8f-13ba4079e6b9';

-- Дарья Миронова (@DVMironova), бывший чат Тани
UPDATE public.profiles SET
  full_name = COALESCE(NULLIF(trim(full_name), ''), 'Дарья Миронова'),
  telegram_username = 'dvmironova',
  telegram_chat_id = -1002787672396
WHERE id = '2007764e-dae6-48e6-8a77-8978b00a3680';
