-- Профили: ролей две (кусок В). Разбор CRM/28, пункт 1. Накатывать ПОСЛЕ выкатки CRM и create-user без роли admin.
begin;
set local lock_timeout = '5s';
alter table public.profiles alter column role set default 'user';
alter table public.profiles alter column role set not null;
alter table public.profiles add constraint profiles_role_two_roles check (role in ('user', 'superadmin'));
commit;
