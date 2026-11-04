-- ============================================================================
-- «Убрать мастера из списков», «Вернуть» и «Удалить» — функции базы (разбор CRM/28, пункт 12).
-- Слово Яна 03.11: ничего не стираем, ушедшего «убираем из списков» (masters.is_active = false, обратимо); в окне видно,
-- что закрыть, «тогда будет возможность убрать»; стереть совсем можно только мастера без единой записи (опечатка в ключе).
-- Что считается «закрыть» (по боевой базе, формулы те же, что в окне Финансов и в form_wallet_slice):
--   1. остаток кошелька — сумма wallet_balance_part по wallet_all мастера равна нулю;
--   2. бензин — нет строк toplivo_all со статусом «не выплачено»;
--   3. будущие работы — нет событий eventsnew (замер, монтаж, рекламация) мастера с датой от сегодняшней по Москве;
--      выходные и «погрузка» не считаются работой;
--   4. метки wallet_holds — нет открытых (released_at is null).
-- Кто может: только суперадмин (is_superadmin()); все функции security definer (masters закрыта на запись).
-- «Убрать» отказывает, пока что-то не закрыто, и называет что (hint = НЕ_ЗАКРЫТО, в detail — числа JSON).
-- «Удалить» отказывает, если у мастера есть хоть одна запись где угодно (hint = ЕСТЬ_ЗАПИСИ): в пяти таблицах по ключу
-- (FK, restrict) и в семи по имени (eventsnew, dobivashki, zamerotkaz, reclamations, reclamationsarchive, ids,
-- manager_masters — FK нет, поэтому считаем сами). Строка настроек топлива уходит вместе с мастером.
-- Откат: drop function public.master_close_check(text), public.deactivate_master(text), public.reactivate_master(text),
--        public.delete_master(text), public.master_footprint(text), public.master_name_norm(text).
-- ============================================================================

begin;
set local lock_timeout = '5s';

create or replace function public.master_name_norm(p_name text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select lower(replace(btrim(coalesce(p_name, '')), 'ё', 'е'))
$function$;

-- Всё, что известно о мастере: деньги, бензин, будущее, метки, число записей. Внутренняя (прав нет ни у кого, кроме
-- владельца и функций ниже), вызывается только после проверки суперадмина.
create or replace function public.master_footprint(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text;
  v_active boolean;
  v_norm text;
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_balance numeric;
  v_fuel int;
  v_future int;
  v_holds int;
  v_by_key jsonb;
  v_by_name jsonb;
  v_records int;
  v_blockers text[] := '{}';
begin
  select m.name, m.is_active into v_name, v_active from public.masters m where m.key = v_key;
  if not found then
    raise exception 'Мастер «%» не найден', v_key using hint = 'МАСТЕР_НЕ_НАЙДЕН';
  end if;
  v_norm := public.master_name_norm(v_name);

  select coalesce(sum(public.wallet_balance_part(w.event_type, w.payment_type, w.amount, w.status)), 0)
    into v_balance from public.wallet_all w where w.master = v_key;
  select count(*) into v_fuel from public.toplivo_all t where t.master = v_key and t.status = 'не выплачено';
  select count(*) into v_future from public.eventsnew e
   where public.master_name_norm(e.master) = v_norm and e.date >= v_today
     and public.master_name_norm(e.type) in ('замер', 'монтаж', 'рекламация');
  select count(*) into v_holds from public.wallet_holds h where h.master = v_key and h.released_at is null;

  v_by_key := jsonb_build_object(
    'wallet_all', (select count(*) from public.wallet_all where master = v_key),
    'walletfinal_all', (select count(*) from public.walletfinal_all where master = v_key),
    'toplivo_all', (select count(*) from public.toplivo_all where master = v_key),
    'wallet_holds', (select count(*) from public.wallet_holds where master = v_key),
    'wallet_slice_log', (select count(*) from public.wallet_slice_log where master = v_key));
  v_by_name := jsonb_build_object(
    'eventsnew', (select count(*) from public.eventsnew where public.master_name_norm(master) = v_norm),
    'dobivashki', (select count(*) from public.dobivashki where public.master_name_norm(master) = v_norm),
    'zamerotkaz', (select count(*) from public.zamerotkaz where public.master_name_norm(master) = v_norm),
    'reclamations', (select count(*) from public.reclamations where public.master_name_norm(visit_master) = v_norm),
    'reclamationsarchive', (select count(*) from public.reclamationsarchive where public.master_name_norm(visit_master) = v_norm),
    'ids', (select count(*) from public.ids where public.master_name_norm(measurement_master) = v_norm),
    'manager_masters', (select count(*) from public.manager_masters where public.master_name_norm(master_name) = v_norm));
  select coalesce(sum(value::int), 0) into v_records
    from jsonb_each_text(v_by_key || v_by_name);

  if abs(v_balance) >= 0.005 then v_blockers := array_append(v_blockers, 'остаток'); end if;
  if v_fuel > 0 then v_blockers := array_append(v_blockers, 'бензин'); end if;
  if v_future > 0 then v_blockers := array_append(v_blockers, 'будущие работы'); end if;
  if v_holds > 0 then v_blockers := array_append(v_blockers, 'метки'); end if;

  return jsonb_build_object(
    'key', v_key, 'name', v_name, 'is_active', v_active,
    'balance', v_balance, 'fuel_unpaid', v_fuel, 'future_work', v_future, 'holds_open', v_holds,
    'records', v_records, 'records_detail', v_by_key || v_by_name,
    'blockers', to_jsonb(v_blockers),
    'can_deactivate', v_active and cardinality(v_blockers) = 0,
    'can_delete', v_records = 0);
end;
$function$;

-- 1. Окно «Убрать из списков»: что закрыть (только чтение) -----------------------
create or replace function public.master_close_check(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_superadmin() then
    raise exception 'Смотреть, что закрыть у мастера, может только суперадмин' using errcode = '42501';
  end if;
  return public.master_footprint(p_key);
end;
$function$;

-- 2. Убрать из списков ------------------------------------------------------------
create or replace function public.deactivate_master(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_fp jsonb;
  v_row public.masters%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Убирать мастера из списков может только суперадмин' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended('wallet_slice:' || v_key, 0));
  perform 1 from public.masters m where m.key = v_key for update;
  if not found then
    raise exception 'Мастер «%» не найден', v_key using hint = 'МАСТЕР_НЕ_НАЙДЕН';
  end if;

  v_fp := public.master_footprint(v_key);
  if not (v_fp ->> 'is_active')::boolean then
    select * into v_row from public.masters where key = v_key;
    return jsonb_build_object('ok', true, 'already', true, 'master', to_jsonb(v_row));
  end if;
  if not (v_fp ->> 'can_deactivate')::boolean then
    raise exception 'Сначала закройте: %', array_to_string(array(select jsonb_array_elements_text(v_fp -> 'blockers')), ', ')
      using hint = 'НЕ_ЗАКРЫТО', detail = v_fp::text;
  end if;

  update public.masters set is_active = false where key = v_key returning * into v_row;
  return jsonb_build_object('ok', true, 'already', false, 'master', to_jsonb(v_row), 'closed', v_fp);
end;
$function$;

-- 3. Вернуть в списки -----------------------------------------------------------
create or replace function public.reactivate_master(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_row public.masters%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'Возвращать мастера в списки может только суперадмин' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  update public.masters set is_active = true where key = v_key returning * into v_row;
  if not found then
    raise exception 'Мастер «%» не найден', v_key using hint = 'МАСТЕР_НЕ_НАЙДЕН';
  end if;
  return jsonb_build_object('ok', true, 'master', to_jsonb(v_row));
end;
$function$;

-- 4. Удалить совсем: только мастера без единой записи ----------------------------
create or replace function public.delete_master(p_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_fp jsonb;
  v_name text;
  v_n int;
begin
  if not public.is_superadmin() then
    raise exception 'Удалять мастера может только суперадмин' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended('wallet_slice:' || v_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('create_master', 0));
  perform 1 from public.masters m where m.key = v_key for update;
  if not found then
    raise exception 'Мастер «%» не найден', v_key using hint = 'МАСТЕР_НЕ_НАЙДЕН';
  end if;

  v_fp := public.master_footprint(v_key);
  if not (v_fp ->> 'can_delete')::boolean then
    raise exception 'Удалить нельзя: у мастера есть записи (%). Его можно только убрать из списков', (v_fp ->> 'records')
      using hint = 'ЕСТЬ_ЗАПИСИ', detail = v_fp::text;
  end if;

  v_name := v_fp ->> 'name';
  delete from public.settings_fuel_masters s where public.master_name_norm(s.master_name) = public.master_name_norm(v_name);
  get diagnostics v_n = row_count;
  if v_n > 1 then
    raise exception 'Строк настроек топлива у «%» больше одной (%), удаление остановлено', v_name, v_n;
  end if;
  delete from public.masters where key = v_key;
  return jsonb_build_object('ok', true, 'deleted', v_key, 'fuel_settings_deleted', v_n);
end;
$function$;

revoke all on function public.master_name_norm(text) from public, anon;
revoke all on function public.master_footprint(text) from public, anon, authenticated;
revoke all on function public.master_close_check(text) from public, anon;
revoke all on function public.deactivate_master(text) from public, anon;
revoke all on function public.reactivate_master(text) from public, anon;
revoke all on function public.delete_master(text) from public, anon;
grant execute on function public.master_name_norm(text) to authenticated, service_role;
grant execute on function public.master_close_check(text) to authenticated, service_role;
grant execute on function public.deactivate_master(text) to authenticated, service_role;
grant execute on function public.reactivate_master(text) to authenticated, service_role;
grant execute on function public.delete_master(text) to authenticated, service_role;

commit;
