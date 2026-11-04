-- Профили: замок и две роли (кусок А). Разбор CRM/28, пункт 1.
-- Было: RLS на profiles выключен, у входящих в CRM есть INSERT/UPDATE/DELETE/TRUNCATE, любой мог записать себе role = 'superadmin'.
-- Стало: RLS включён; клиент профили только читает, удаляет только суперадмин; пишет сервер (service_role) и триггер handle_new_user;
-- Проверка «суперадмин?» — одна функция is_superadmin(). Две роли (CHECK) — отдельным куском В после выкатки CRM.
begin;
set local lock_timeout = '5s';

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'superadmin'
  )
$fn$;

revoke all on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated, service_role;

alter function public.get_current_user_role() set search_path = public;

do $b$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', r.policyname);
  end loop;
end
$b$;

alter table public.profiles enable row level security;

revoke all on table public.profiles from authenticated, anon;
grant select, delete on table public.profiles to authenticated;

create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);
create policy profiles_delete_superadmin on public.profiles
  for delete to authenticated using (public.is_superadmin());

commit;
