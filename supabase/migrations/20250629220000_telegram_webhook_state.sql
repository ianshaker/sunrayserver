-- Состояние Telegram-вебхука (намерение «включён» + последний статус).
-- Зачем: после рестарта/redeploy сервер знает, что вебхук надо держать
-- активным, и при необходимости переустанавливает его (self-heal).
-- Читает/пишет только сервер через service_role.

CREATE TABLE IF NOT EXISTS public.telegram_webhook_state (
  id TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT false,
  url TEXT,
  secret_set BOOLEAN NOT NULL DEFAULT false,
  last_info JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_webhook_state ENABLE ROW LEVEL SECURITY;

-- Доступ только через service_role (он обходит RLS).
-- anon/authenticated политик не имеют → состояние им не видно.
GRANT ALL ON public.telegram_webhook_state TO service_role;
