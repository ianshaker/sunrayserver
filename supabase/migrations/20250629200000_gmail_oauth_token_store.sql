-- Хранилище OAuth-токена Gmail в Supabase.
-- Зачем: на Render диск эфемерный и свой у каждого инстанса + стирается при redeploy.
-- Общий токен в БД переживает деплои и виден всем инстансам (cron подхватывает за минуту).

CREATE TABLE IF NOT EXISTS public.gmail_oauth_tokens (
  id TEXT PRIMARY KEY,
  token JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gmail_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Доступ только через service_role (он обходит RLS).
-- anon/authenticated политик не имеют → токен им не виден.
GRANT ALL ON public.gmail_oauth_tokens TO service_role;
