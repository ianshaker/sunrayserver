-- См. sunray-crm-oasis/supabase/migrations/20250629180000_manager_tasks_due_reminder.sql
-- (та же миграция для manager_tasks в Supabase xyzkneqhggpxstxqbqhs)

ALTER TABLE public.manager_tasks
  ADD COLUMN IF NOT EXISTS due_reminder_sent_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_manager_tasks_due_reminders
  ON public.manager_tasks (due_date)
  WHERE status IN ('pending', 'in_progress')
    AND due_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reset_manager_task_due_reminder()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.due_reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_tasks_reset_due_reminder ON public.manager_tasks;

CREATE TRIGGER trg_manager_tasks_reset_due_reminder
  BEFORE UPDATE ON public.manager_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_manager_task_due_reminder();

CREATE OR REPLACE FUNCTION public.claim_manager_task_due_reminder(p_task_id UUID)
RETURNS SETOF public.manager_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.manager_tasks t
  SET due_reminder_sent_at = now()
  WHERE t.id = p_task_id
    AND t.status IN ('pending', 'in_progress')
    AND t.due_date IS NOT NULL
    AND t.due_date <= now()
    AND (
      t.due_reminder_sent_at IS NULL
      OR t.due_reminder_sent_at <= now() - interval '30 minutes'
    )
  RETURNING t.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_manager_task_due_reminder(UUID) TO service_role;
