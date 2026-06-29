-- При завершении задачи дедлайн и метка напоминания больше не нужны.

CREATE OR REPLACE FUNCTION public.clear_manager_task_deadline_on_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed'::task_status THEN
    NEW.due_date := NULL;
    NEW.due_reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_tasks_clear_deadline_on_completed ON public.manager_tasks;

CREATE TRIGGER trg_manager_tasks_clear_deadline_on_completed
  BEFORE INSERT OR UPDATE OF status ON public.manager_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_manager_task_deadline_on_completed();
