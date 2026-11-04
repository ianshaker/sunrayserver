-- ============================================================================
-- Отмена договора (cancel_contract) пишет топливо прямо в общую таблицу toplivo_all
-- (разбор CRM/28 «Новый мастер», пункт 6, шаг Г). Накатывается тем же переключением, что
-- 20261104150000_toplivo_all.sql, сразу после него.
-- Изменено только топливо (раздел 5): delete и чтение — по (master, id) в toplivo_all вместо
-- динамического имени toplivo_<ключ>; мастер проверяется по справочнику masters вместо
-- зашитого списка 12 ключей. Остальное тело — как в живой базе на 04.11.2026.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_contract(p_table text, p_contract_id integer, p_dogovor_number text, p_reason text, p_wallet_ops jsonb, p_event_ids integer[], p_fuel jsonb, p_queue_ids integer[], p_measurement_keep numeric, p_installation_keep numeric, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $function$
declare
  c_new_sum constant numeric := 0;
  v_uid uuid := auth.uid();
  v_name text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb;
  v_appeal text;
  v_total_cost numeric;
  v_income numeric;
  v_wallet jsonb;
  v_skipped jsonb;
  v_tmp jsonb;
  v_q record;
  v_rem jsonb;
  v_queue_removed jsonb := '[]'::jsonb;
  v_queue_done integer[] := '{}';
  v_f jsonb;
  v_master text;
  v_fid integer;
  v_fuel_row jsonb;
  v_fuel_st text;
  v_fuel_et text;
  v_fuel_cn text;
  v_fuel_ap text;
  v_fuel_deleted jsonb := '[]'::jsonb;
  v_fuel_ids jsonb := '[]'::jsonb;
  v_events integer[] := '{}';
  v_events_kept integer[] := '{}';
  v_events_gone integer[] := '{}';
  v_events_snapshot jsonb := '[]'::jsonb;
  v_rows integer;
  v_fin jsonb;
  v_finished_id bigint;
  v_cancellation_id bigint;
  v_result jsonb;
  -- «Сегодня» и «сейчас» по Москве (события монтажа хранятся по московскому времени): так же, как событиеПрошло в CRM
  v_today date := (now() at time zone 'Europe/Moscow')::date;
  v_hm text := to_char(now() at time zone 'Europe/Moscow', 'HH24:MI');
begin
  -- 1. Кто, зачем, куда
  if v_uid is null then
    raise exception 'Войдите в CRM, чтобы отменить договор';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Укажите причину отмены — не короче 3 знаков';
  end if;
  if p_table is null or p_table not in ('dogovornew', 'dogovorfinished') then
    raise exception 'Отмена: неизвестная таблица договора «%»', coalesce(p_table, '');
  end if;
  if p_contract_id is null or coalesce(btrim(p_dogovor_number), '') = '' then
    raise exception 'Отмена: не указан договор (id и номер)';
  end if;
  if p_measurement_keep is null or p_installation_keep is null or p_measurement_keep < 0 or p_installation_keep < 0 then
    raise exception 'Отмена: суммы, что остаются замерщику и монтажнику, — числа не меньше нуля';
  end if;
  select p.full_name into v_name from public.profiles p where p.id = v_uid;

  -- 2. Договор под замок: по id И номеру (id двух таблиц совпадают у разных договоров)
  execute format(
    'select to_jsonb(d) from public.%I d where d.id = $1 and d.dogovor_number = $2 for update', p_table)
    into v_before using p_contract_id, p_dogovor_number;
  if v_before is null then
    raise exception 'Договор изменился или не найден'
      using detail = format('Таблица %s, id %s, номер %s', p_table, p_contract_id, p_dogovor_number);
  end if;
  -- Версия: опись подтверждали по договору, каким его прочитало окно. Договор поменяли с тех пор (вторая вкладка, другой человек,
  -- отмена уже прошла) — операции устарели. Для dogovornew повтор и так отказывает (строки уже нет), а у «Завершённых» строка
  -- остаётся на месте: без этой проверки вторая отмена вставила бы строки-разницы и метки ещё раз
  if p_expected_updated_at is not null
     and (v_before->>'updated_at')::timestamptz is distinct from p_expected_updated_at then
    raise exception 'Договор изменился или не найден'
      using detail = format('Таблица %s, id %s, номер %s: договор поменяли после того, как открыли окно отмены',
                            p_table, p_contract_id, p_dogovor_number);
  end if;
  v_appeal := v_before->>'appeal_id';
  v_total_cost := coalesce((v_before->>'total_cost')::numeric, 0);

  -- 3. Деньги мастеров: правки, строки-разницы, метки
  perform set_config('sunray.wallet_ops_caller', 'cancel_contract', true);
  v_wallet := public.apply_wallet_ops(p_wallet_ops, p_dogovor_number, v_appeal);
  perform set_config('sunray.wallet_ops_caller', '', true);
  v_skipped := coalesce(v_wallet->'skipped', '[]'::jsonb);

  -- 4. Карточки монтажки: только этого договора; каждую снимает remove_from_installation (она пишет свой журнал снятий)
  for v_q in
    select q.id, q.status
    from public.installation_contracts q
    where q.id = any (p_queue_ids) and q.dogovor_number = p_dogovor_number
    order by q.id
  loop
    v_rem := public.remove_from_installation(v_q.id, 'Договор закрыт или отменён', v_reason);
    v_queue_done := v_queue_done || v_q.id;
    v_queue_removed := v_queue_removed || jsonb_build_array(jsonb_build_object('id', v_q.id, 'status', v_q.status, 'result', v_rem));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object(
           'what', 'карточка очереди', 'id', u, 'why', 'карточки нет или она не этого договора') order by u), '[]'::jsonb)
    into v_tmp
  from unnest(p_queue_ids) u
  where u <> all (v_queue_done);
  v_skipped := v_skipped || v_tmp;

  -- 5. Топливо будущего монтажа: только невыплаченное «монтаж»; выплаченное или чужое не трогаем, пишем в итог
  if p_fuel is not null and jsonb_typeof(p_fuel) <> 'null' then
    if jsonb_typeof(p_fuel) <> 'array' then
      raise exception 'Отмена: топливо должно идти списком';
    end if;
    for v_f in select e.value from jsonb_array_elements(p_fuel) with ordinality as e(value, ord) order by e.ord loop
      v_master := v_f->>'master';
      -- Мастер — из справочника masters (с 04.11.2026: и новый мастер, и ушедший, чьи поездки остались)
      if v_master is null or not exists (select 1 from public.masters m where m.key = v_master) then
        raise exception 'Отмена: в топливе мастер «%» не из списка', coalesce(v_master, '');
      end if;
      if jsonb_typeof(v_f->'id') is distinct from 'number' or (v_f->>'id') !~ '^[0-9]{1,9}$' then
        raise exception 'Отмена: в топливе у мастера % нет номера записи (id)', v_master;
      end if;
      v_fid := (v_f->>'id')::integer;
      -- Только топливо ЭТОГО договора, как в описи CRM: номер договора записи совпал с номером отменяемого, а у записи без номера
      -- — обращение совпало с обращением договора. Запись другого договора (в том числе на том же обращении) не трогаем
      -- Топливо всех мастеров — в toplivo_all; номер записи уникален только внутри мастера, поэтому всегда и master, и id
      delete from public.toplivo_all t
       where t.master = v_master and t.id = v_fid and t.status = 'не выплачено' and lower(t.event_type) = 'монтаж'
         and (lower(btrim(t.contract_id)) = lower(btrim(p_dogovor_number))
              or (coalesce(btrim(t.contract_id), '') = '' and coalesce(v_appeal, '') <> '' and t.appeal_id = v_appeal))
      returning to_jsonb(t) into v_fuel_row;
      if v_fuel_row is not null then
        v_fuel_deleted := v_fuel_deleted || jsonb_build_array(jsonb_build_object('master', v_master, 'id', v_fid, 'row', v_fuel_row));
        v_fuel_ids := v_fuel_ids || jsonb_build_array(jsonb_build_object('master', v_master, 'id', v_fid));
      else
        v_fuel_st := null;
        v_fuel_et := null;
        v_fuel_cn := null;
        v_fuel_ap := null;
        select t.status, t.event_type, t.contract_id, t.appeal_id
          into v_fuel_st, v_fuel_et, v_fuel_cn, v_fuel_ap
        from public.toplivo_all t
        where t.master = v_master and t.id = v_fid;
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'what', 'топливо', 'master', v_master, 'id', v_fid,
          'why', case
                   when v_fuel_et is null then 'записи топлива нет'
                   when v_fuel_st <> 'не выплачено' then 'топливо уже выплачено'
                   when lower(v_fuel_et) <> 'монтаж' then 'это не топливо монтажа'
                   else 'это топливо другого договора — не трогаем'
                 end));
      end if;
    end loop;
  end if;

  -- 6. Сам договор: нули, что остаётся мастерам, статус «Отменен»; income — формула CRM при сохранении
  --    (contractSaveService.ts: сумма договора есть ? сумма − затраты фабрик − замер − монтаж : 0), при сумме 0 это 0
  v_income := case
                when c_new_sum <> 0 then c_new_sum - v_total_cost - p_measurement_keep - p_installation_keep
                else 0
              end;
  execute format(
    $q$update public.%I
       set contract_sum = 0, advance_payment = 0, remaining_sum = 0,
           measurement = $1, installation = $2, status = 'Отменен', income = $3, updated_at = now()
       where id = $4 and dogovor_number = $5$q$, p_table)
    using p_measurement_keep, p_installation_keep, v_income, p_contract_id, p_dogovor_number;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Договор изменился или не найден'
      using detail = format('Таблица %s, id %s, номер %s', p_table, p_contract_id, p_dogovor_number);
  end if;

  -- 7. События монтажа: id из браузера не верим — берём только «Монтаж» этого договора, который ещё не прошёл (прошедшие не трогаем);
  --    привязанные к рекламации остаются. «Прошёл» — как событиеПрошло в CRM: конец раньше начала — это следующий день; прошло то,
  --    что кончилось (нет конца — началось) не позже «сейчас» по Москве до минуты; без даты — не знаем, оставляем
  if coalesce(array_length(p_event_ids, 1), 0) > 0 then
    v_events := array(
      select e.id
      from public.eventsnew e
      cross join lateral (
        select case
                 when e.start_time is not null and e.end_time is not null
                      and to_char(e.end_time, 'HH24:MI') < to_char(e.start_time, 'HH24:MI') then e.date + 1
                 else e.date
               end as end_day
      ) d
      where e.id = any (p_event_ids) and e.contract_number = p_dogovor_number and e.type = 'Монтаж'
        and e.date is not null
        and not (d.end_day < v_today
                 or (d.end_day = v_today
                     and coalesce(to_char(coalesce(e.end_time, e.start_time), 'HH24:MI') <= v_hm, false)))
      order by e.id);
    v_events_kept := array(
      select e.id from public.eventsnew e
      where e.id = any (v_events) and exists (select 1 from public.reclamations r where r.linked_event_id = e.id)
      order by e.id);
    v_events_gone := array(select u from unnest(v_events) u where u <> all (v_events_kept) order by u);
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) into v_events_snapshot
    from public.eventsnew e
    where e.id = any (v_events_gone);
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', 'событие', 'id', u,
             'why', coalesce((
               select case
                        when e.contract_number is distinct from p_dogovor_number or e.type <> 'Монтаж' then 'это не «Монтаж» этого договора'
                        when e.date is null then 'у события нет даты — не знаем, прошёл ли монтаж'
                        else 'монтаж уже прошёл — прошедшие не трогаем'
                      end
               from public.eventsnew e where e.id = u), 'события нет')) order by u), '[]'::jsonb)
      into v_tmp
    from unnest(p_event_ids) u
    where u <> all (v_events);
    v_skipped := v_skipped || v_tmp;
  end if;

  if p_table = 'dogovornew' then
    -- Копия уже обнулённой строки уходит в «Завершённые»; третий параметр false — прошедшие монтажи по номеру не сносим
    v_fin := public.finish_contract(p_contract_id, case when cardinality(v_events) > 0 then v_events else null end, false);
    v_finished_id := (v_fin->>'finished_id')::bigint;
  else
    -- Договор уже в «Завершённых»: finish_contract не зовём (ищет по id в dogovornew), события снимаем сами
    delete from public.eventsnew e
    where e.id = any (v_events_gone) and e.contract_number = p_dogovor_number and e.type = 'Монтаж'
      and not exists (select 1 from public.reclamations r where r.linked_event_id = e.id);
    v_finished_id := p_contract_id;
  end if;

  -- 8. Журнал отмен и ответ
  v_result := jsonb_build_object(
    'table', p_table,
    'dogovor_number', p_dogovor_number,
    'contract_id', p_contract_id,
    'finished_id', v_finished_id,
    'edited', coalesce((v_wallet->>'edited')::integer, 0),
    'removed', coalesce((v_wallet->>'removed')::integer, 0),
    'inserted', coalesce((v_wallet->>'inserted')::integer, 0),
    'holds', coalesce((v_wallet->>'holds')::integer, 0),
    'events', jsonb_build_object('deleted', to_jsonb(v_events_gone), 'kept', to_jsonb(v_events_kept)),
    'fuel', jsonb_build_object('deleted', v_fuel_ids),
    'queue', jsonb_build_object('removed', to_jsonb(v_queue_done)),
    'skipped', v_skipped
  );

  insert into public.contract_cancellations (
    dogovor_number, appeal_id, source_table, reason, cancelled_by, cancelled_by_name,
    contract_before, wallet_ops, events_deleted, fuel_deleted, queue_removed, result
  ) values (
    p_dogovor_number, v_appeal, p_table, v_reason, v_uid, v_name,
    v_before, v_wallet, v_events_snapshot, v_fuel_deleted, v_queue_removed, v_result
  ) returning id into v_cancellation_id;

  return v_result || jsonb_build_object('cancellation_id', v_cancellation_id);
end;
$function$;

notify pgrst, 'reload schema';
