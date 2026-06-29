-- Завершённые и отменённые задачи → автоматически в архив.
-- Удаление (DELETE) — только hard delete, без архива.
-- Синхронизация полей archive с manager_tasks (tg origin, due_reminder).

-- ── 1. Недостающие колонки в архиве ─────────────────────────────────────────

ALTER TABLE public.manager_tasks_archive
  ADD COLUMN IF NOT EXISTS tg_chat_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS tg_message_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS due_reminder_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.manager_tasks_archive.tg_chat_id IS
  'Копия tg_chat_id при архивации (Telegram-задачи).';
COMMENT ON COLUMN public.manager_tasks_archive.tg_message_id IS
  'Копия tg_message_id при архивации.';
COMMENT ON COLUMN public.manager_tasks_archive.due_reminder_sent_at IS
  'Копия метки напоминания на момент архивации.';

-- ── 2. Очистка дедлайна при completed / cancelled (до архивации) ─────────────

CREATE OR REPLACE FUNCTION public.clear_manager_task_deadline_on_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'completed'::task_status THEN
    NEW.due_date := NULL;
    NEW.due_reminder_sent_at := NULL;
  ELSIF NEW.status = 'cancelled'::task_status THEN
    NEW.due_reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Перенос строки в архив (service_role + триггер) ───────────────────────

CREATE OR REPLACE FUNCTION public.move_manager_task_to_archive(
  p_task_id uuid,
  p_archived_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_record public.manager_tasks%ROWTYPE;
BEGIN
  SELECT * INTO task_record
  FROM public.manager_tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.manager_tasks_archive (
    title, description, assigned_to, assigned_by, assignees, controllers,
    status, priority, due_date, created_at, updated_at, pinned_at,
    task_number, tg_chat_id, tg_message_id, due_reminder_sent_at,
    archived_by, original_id, archived_at
  ) VALUES (
    task_record.title, task_record.description, task_record.assigned_to,
    task_record.assigned_by, task_record.assignees, task_record.controllers,
    task_record.status, task_record.priority, task_record.due_date,
    task_record.created_at, task_record.updated_at, task_record.pinned_at,
    task_record.task_number, task_record.tg_chat_id, task_record.tg_message_id,
    task_record.due_reminder_sent_at,
    p_archived_by, task_record.id, now()
  );

  DELETE FROM public.manager_tasks WHERE id = p_task_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_manager_task_to_archive(uuid, uuid) TO service_role;

-- ── 4. Триггер: completed / cancelled → архив ────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_manager_task_auto_archive()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed'::task_status, 'cancelled'::task_status)
     AND OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status NOT IN ('completed'::task_status, 'cancelled'::task_status) THEN
    PERFORM public.move_manager_task_to_archive(NEW.id, NEW.assigned_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_tasks_auto_archive ON public.manager_tasks;

CREATE TRIGGER trg_manager_tasks_auto_archive
  AFTER UPDATE OF status ON public.manager_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_manager_task_auto_archive();

-- ── 5. Перенос уже закрытых задач из manager_tasks в архив ───────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, assigned_by
    FROM public.manager_tasks
    WHERE status IN ('completed'::task_status, 'cancelled'::task_status)
  LOOP
    PERFORM public.move_manager_task_to_archive(r.id, r.assigned_by);
  END LOOP;
END;
$$;

-- ── 6. RPC archive_manager_task — обёртка (CRM, completed/cancelled) ─────────

CREATE OR REPLACE FUNCTION public.archive_manager_task(task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_record public.manager_tasks%ROWTYPE;
BEGIN
  SELECT * INTO task_record
  FROM public.manager_tasks
  WHERE id = task_id
    AND assigned_by = auth.uid()
    AND status IN ('completed'::task_status, 'cancelled'::task_status);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Задача не найдена или вы не можете её архивировать. Архивировать можно только завершённые или отменённые задачи, созданные вами.';
  END IF;

  PERFORM public.move_manager_task_to_archive(task_id, auth.uid());
END;
$$;

-- ── 7. restore — вернуть tg-поля ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_manager_task(task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_task_record public.manager_tasks_archive%ROWTYPE;
BEGIN
  SELECT * INTO archived_task_record
  FROM public.manager_tasks_archive
  WHERE id = task_id
    AND archived_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Архивная задача не найдена или вы не можете её восстановить.';
  END IF;

  INSERT INTO public.manager_tasks (
    id, title, description, assigned_to, assigned_by, assignees, controllers,
    status, priority, due_date, created_at, updated_at, task_number, pinned_at,
    tg_chat_id, tg_message_id, due_reminder_sent_at
  ) VALUES (
    archived_task_record.original_id, archived_task_record.title,
    archived_task_record.description, archived_task_record.assigned_to,
    archived_task_record.assigned_by, archived_task_record.assignees,
    archived_task_record.controllers, 'pending'::task_status,
    archived_task_record.priority, archived_task_record.due_date,
    archived_task_record.created_at, now(), archived_task_record.task_number,
    archived_task_record.pinned_at,
    archived_task_record.tg_chat_id, archived_task_record.tg_message_id,
    NULL
  );

  DELETE FROM public.manager_tasks_archive WHERE id = task_id;
END;
$$;
