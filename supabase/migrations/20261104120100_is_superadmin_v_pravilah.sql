-- Профили: проверка «суперадмин?» — одна функция (кусок Б). Разбор CRM/28, пункт 1.
-- Переключаю остальные правила с копии подзапроса на public.is_superadmin(); условие то же.
-- Правила на profiles уже пересозданы куском А. Две правила contract_rollback_audit сужаются с admin/директор/superadmin до superadmin (таких людей нет).
begin;
set local lock_timeout = '5s';

alter policy "Superadmin can manage cities" on public.cities using (public.is_superadmin()) with check (public.is_superadmin());
alter policy "Superadmin can manage company addresses" on public.company_addresses using (public.is_superadmin()) with check (public.is_superadmin());
alter policy "Admins can insert contract rollback audit" on public.contract_rollback_audit with check (public.is_superadmin());
alter policy "Admins can view contract rollback audit" on public.contract_rollback_audit using (public.is_superadmin());
alter policy "Superadmin can read contract template versions" on public.contract_template_versions using (public.is_superadmin());
alter policy "Superadmin can manage contract templates" on public.contract_templates using (public.is_superadmin()) with check (public.is_superadmin());
alter policy "Только SuperAdmin может изменять связи " on public.manager_masters using (public.is_superadmin()) with check (public.is_superadmin());
alter policy "Super admin can create tasks for anyone" on public.manager_tasks with check (public.is_superadmin());
alter policy "Super admin can delete all tasks" on public.manager_tasks using (public.is_superadmin());
alter policy "Super admin can update all tasks" on public.manager_tasks using (public.is_superadmin());
alter policy "Super admin can view all manager tasks" on public.manager_tasks using (public.is_superadmin());
alter policy "Super admin can view all archived tasks" on public.manager_tasks_archive using (public.is_superadmin());
alter policy "telegram_bot_chats_superadmin_write" on public.telegram_bot_chats using (public.is_superadmin()) with check (public.is_superadmin());
alter policy "Super admin can delete tg ad channels" on public.tg_ad_channels using (public.is_superadmin());
alter policy "Super admin can delete tg ad placements" on public.tg_ad_placements using (public.is_superadmin());

commit;
