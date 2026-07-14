-- Александра Балукова: опечатка в нике (albalyxs → albaluxs).
-- Из‑за несовпадения resolveProfileIdByTelegramUser возвращал null —
-- уведомления о дедлайнах в группе работали, а действия (обновить/перенести) — нет.
-- telegram_user_id подтянется при первом сообщении от @AlBaluxs (tasks/directory.js).

UPDATE public.profiles SET
  telegram_username = 'albaluxs'
WHERE id = 'c29869e0-473f-4a3e-a517-687a1a1c0e42';
