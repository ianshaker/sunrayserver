-- Гена: в 20250629240000 проставили telegram_chat_id, но забыли username.
-- Без telegram_username @упоминания в групповых напоминаниях не работают.
-- user_id подтянется автоматически при первом сообщении/кнопке от @yaqudzo (tasks/directory.js).

UPDATE public.profiles SET
  full_name = COALESCE(NULLIF(trim(full_name), ''), 'Гена'),
  telegram_username = 'yaqudzo'
WHERE id = 'c9fa6e25-b2ae-4e68-ad4e-e50bffebd071';
