-- Короткий числовой номер задачи (#42) для UI, Telegram и будущих AI-команд.
-- Номера не переиспользуются (NO CYCLE).

CREATE SEQUENCE IF NOT EXISTS public.manager_task_number_seq
  AS INTEGER
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  NO CYCLE;

ALTER TABLE public.manager_tasks
  ADD COLUMN IF NOT EXISTS task_number INTEGER;

ALTER TABLE public.manager_tasks_archive
  ADD COLUMN IF NOT EXISTS task_number INTEGER;

-- Существующим задачам — номера по дате создания (активные + архив, один проход).
WITH all_tasks AS (
  SELECT id, 'active'::text AS src, created_at
  FROM public.manager_tasks
  UNION ALL
  SELECT id, 'archive'::text AS src, created_at
  FROM public.manager_tasks_archive
),
numbered AS (
  SELECT
    id,
    src,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS num
  FROM all_tasks
)
UPDATE public.manager_tasks t
SET task_number = n.num
FROM numbered n
WHERE n.src = 'active' AND n.id = t.id;

WITH all_tasks AS (
  SELECT id, 'active'::text AS src, created_at
  FROM public.manager_tasks
  UNION ALL
  SELECT id, 'archive'::text AS src, created_at
  FROM public.manager_tasks_archive
),
numbered AS (
  SELECT
    id,
    src,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS num
  FROM all_tasks
)
UPDATE public.manager_tasks_archive t
SET task_number = n.num
FROM numbered n
WHERE n.src = 'archive' AND n.id = t.id;

SELECT setval(
  'public.manager_task_number_seq',
  COALESCE(
    (SELECT MAX(task_number) FROM (
      SELECT task_number FROM public.manager_tasks
      UNION ALL
      SELECT task_number FROM public.manager_tasks_archive
    ) combined),
    0
  ),
  true
);

ALTER TABLE public.manager_tasks
  ALTER COLUMN task_number SET NOT NULL;

ALTER TABLE public.manager_tasks_archive
  ALTER COLUMN task_number SET NOT NULL;

ALTER TABLE public.manager_tasks
  ADD CONSTRAINT manager_tasks_task_number_key UNIQUE (task_number);

ALTER TABLE public.manager_tasks_archive
  ADD CONSTRAINT manager_tasks_archive_task_number_key UNIQUE (task_number);

ALTER TABLE public.manager_tasks
  ALTER COLUMN task_number SET DEFAULT nextval('public.manager_task_number_seq');

CREATE INDEX IF NOT EXISTS idx_manager_tasks_task_number
  ON public.manager_tasks (task_number);

COMMENT ON COLUMN public.manager_tasks.task_number IS
  'Публичный номер задачи (#N). Выдаётся sequence, не переиспользуется.';

COMMENT ON COLUMN public.manager_tasks_archive.task_number IS
  'Копия task_number при архивации; тот же номер после restore.';

-- Архивация / восстановление с сохранением номера.
CREATE OR REPLACE FUNCTION public.archive_manager_task(task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  task_record manager_tasks%ROWTYPE;
BEGIN
  SELECT * INTO task_record
  FROM public.manager_tasks
  WHERE id = task_id
    AND assigned_by = auth.uid()
    AND status = 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Задача не найдена или вы не можете её архивировать. Архивировать можно только завершенные задачи, созданные вами.';
  END IF;

  INSERT INTO public.manager_tasks_archive (
    title, description, assigned_to, assigned_by, assignees, controllers,
    status, priority, due_date, created_at, updated_at,
    archived_by, original_id, task_number
  ) VALUES (
    task_record.title, task_record.description, task_record.assigned_to,
    task_record.assigned_by, task_record.assignees, task_record.controllers,
    task_record.status, task_record.priority, task_record.due_date,
    task_record.created_at, task_record.updated_at, auth.uid(), task_record.id,
    task_record.task_number
  );

  DELETE FROM public.manager_tasks WHERE id = task_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_manager_task(task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  archived_task_record manager_tasks_archive%ROWTYPE;
BEGIN
  SELECT * INTO archived_task_record
  FROM public.manager_tasks_archive
  WHERE id = task_id
    AND archived_by = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Архивная задача не найдена или вы не можете её восстановить. Восстанавливать можно только задачи, которые вы заархивировали.';
  END IF;

  INSERT INTO public.manager_tasks (
    id, title, description, assigned_to, assigned_by, assignees, controllers,
    status, priority, due_date, created_at, updated_at, task_number
  ) VALUES (
    archived_task_record.original_id, archived_task_record.title,
    archived_task_record.description, archived_task_record.assigned_to,
    archived_task_record.assigned_by, archived_task_record.assignees,
    archived_task_record.controllers, 'pending'::task_status,
    archived_task_record.priority, archived_task_record.due_date,
    archived_task_record.created_at, now(), archived_task_record.task_number
  );

  DELETE FROM public.manager_tasks_archive WHERE id = task_id;
END;
$function$;

-- Поиск активной задачи по номеру (CRM / будущий AI).
CREATE OR REPLACE FUNCTION public.get_manager_task_by_number(p_task_number INTEGER)
RETURNS SETOF public.manager_tasks
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT *
  FROM public.manager_tasks
  WHERE task_number = p_task_number;
$$;

GRANT EXECUTE ON FUNCTION public.get_manager_task_by_number(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manager_task_by_number(INTEGER) TO service_role;
