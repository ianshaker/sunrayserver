-- ============================================================================
-- apply_wallet_ops пишет кошельки прямо в общую таблицу wallet_all (разбор CRM/28, пункт 6).
-- Накатывается тем же переключением, сразу после 20261104150200_wallet_all.sql.
-- Изменено только обращение к кошельку: статичный SQL по (master, id) в wallet_all вместо
-- динамического имени wallet_<ключ>; мастер проверяется по masters вместо зашитого списка.
-- Остальное тело (защита вызова, проверки, метки, номер проводки) — как в живой базе на 04.11.2026.
-- В снимок строки (before) теперь входит поле master.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_wallet_ops(p_ops jsonb, p_dogovor_number text, p_appeal_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_ops jsonb := p_ops;
  v_op jsonb;
  v_n integer := 0;
  v_kind text;
  v_master text;
  v_id integer;
  v_expected numeric;
  v_amount numeric;
  v_event text;
  v_event_type text;
  v_payment text;
  v_appeal text;
  v_tr text;
  v_cand text;
  v_try integer;
  v_reason text;
  v_before jsonb;
  v_new_id integer;
  v_rows integer;
  v_date date := (now() at time zone 'Europe/Moscow')::date;
  v_time time := date_trunc('second', now() at time zone 'Europe/Moscow')::time;
  v_edited integer := 0;
  v_removed integer := 0;
  v_inserted integer := 0;
  v_holds integer := 0;
  v_applied jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  -- Снаружи нельзя: только postgres/service_role и вызов изнутри (флаг ставят cancel_contract и apply_contract_money)
  if current_user not in ('postgres', 'service_role')
     and coalesce(current_setting('sunray.wallet_ops_caller', true), '') not in ('cancel_contract', 'apply_contract_money') then
    raise exception 'apply_wallet_ops — внутренняя функция, её зовут только cancel_contract и apply_contract_money'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_dogovor_number), '') = '' then
    raise exception 'Кошельки: не указан номер договора';
  end if;
  if v_ops is null or jsonb_typeof(v_ops) = 'null' then
    v_ops := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_ops) <> 'array' then
    raise exception 'Кошельки: операции должны идти списком';
  end if;
  if v_uid is not null then
    select p.full_name into v_name from public.profiles p where p.id = v_uid;
  end if;

  for v_op in
    select e.value from jsonb_array_elements(v_ops) with ordinality as e(value, ord) order by e.ord
  loop
    v_n := v_n + 1;
    if jsonb_typeof(v_op) <> 'object' then
      raise exception 'Кошельки, операция %: ожидается объект', v_n;
    end if;
    v_kind := v_op->>'op';
    v_master := v_op->>'master';
    -- Мастер — из справочника masters (с 04.11.2026: и новый мастер, и ушедший, чьи строки остались)
    if v_master is null or not exists (select 1 from public.masters m where m.key = v_master) then
      raise exception 'Кошельки, операция %: мастер «%» не из списка кошельков', v_n, coalesce(v_master, '');
    end if;

    if v_kind in ('править', 'метка') then
      if jsonb_typeof(v_op->'id') is distinct from 'number' or (v_op->>'id') !~ '^[0-9]{1,9}$' then
        raise exception 'Кошельки, операция %: нет номера строки (id)', v_n;
      end if;
      v_id := (v_op->>'id')::integer;
    end if;

    if v_kind = 'править' then
      -- Править можно только свободную строку: «Несортированные», не подтверждена, сумма всё та же, что видели в окне
      if jsonb_typeof(v_op->'expected') is distinct from 'number' or jsonb_typeof(v_op->'amount') is distinct from 'number' then
        raise exception 'Кошельки, операция %: нужны числа expected и amount', v_n;
      end if;
      v_expected := (v_op->>'expected')::numeric;
      v_amount := (v_op->>'amount')::numeric;
      v_event := nullif(btrim(v_op->>'event'), '');
      if v_amount <> 0 and v_event is null then
        raise exception 'Кошельки, операция %: нет текста строки (event)', v_n;
      end if;

      -- Кошельки всех мастеров — в wallet_all; номер строки уникален только внутри мастера, поэтому всегда и master, и id
      select to_jsonb(w) into v_before from public.wallet_all w
       where w.master = v_master and w.id = v_id and w.slice_status = 'unsorted' and w.status = 'неподтверждено'
         and w.amount = v_expected
       for update;
      if v_before is null then
        raise exception 'Строка кошелька изменилась или её уже нет: мастер %, id %, ожидали сумму %', v_master, v_id, v_expected
          using detail = 'Править можно только свободную строку: «Несортированные», не подтверждена, сумма как в окне.';
      end if;

      if v_amount = 0 then
        delete from public.wallet_all w
         where w.master = v_master and w.id = v_id and w.slice_status = 'unsorted' and w.status = 'неподтверждено'
           and w.amount = v_expected;
      else
        update public.wallet_all w set amount = v_amount, event = v_event, updated_at = now()
         where w.master = v_master and w.id = v_id and w.slice_status = 'unsorted' and w.status = 'неподтверждено'
           and w.amount = v_expected;
      end if;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception 'Строка кошелька изменилась: мастер %, id % (затронуто строк: %)', v_master, v_id, v_rows;
      end if;

      if v_amount = 0 then
        v_removed := v_removed + 1;
      else
        v_edited := v_edited + 1;
      end if;
      v_applied := v_applied || jsonb_build_array(jsonb_build_object(
        'op', 'править', 'master', v_master, 'id', v_id, 'removed', v_amount = 0,
        'amount_before', v_expected, 'amount_after', v_amount, 'event', v_event, 'before', v_before
      ));

    elsif v_kind = 'вставить' then
      if jsonb_typeof(v_op->'amount') is distinct from 'number' then
        raise exception 'Кошельки, операция %: нужно число amount', v_n;
      end if;
      v_amount := (v_op->>'amount')::numeric;
      v_event_type := nullif(btrim(v_op->>'event_type'), '');
      v_event := nullif(btrim(v_op->>'event'), '');
      v_payment := nullif(btrim(v_op->>'payment_type'), '');
      if v_event_type is null or v_event is null or v_payment is null then
        raise exception 'Кошельки, операция %: у новой строки нужны event_type, event и payment_type', v_n;
      end if;
      v_appeal := coalesce(nullif(btrim(v_op->>'appeal_id'), ''), nullif(btrim(p_appeal_id), ''));

      -- Номер строки-разницы: из общего генератора; совпал с чьим-то (любой кошелёк, срезы тоже) — берём другой, до 3 раз
      v_tr := null;
      for v_try in 1..3 loop
        v_cand := public.generate_transaction_number();
        if not exists (select 1 from public.finance_transactions_all f where f.transaction_number = v_cand) then
          v_tr := v_cand;
          exit;
        end if;
      end loop;
      if v_tr is null then
        raise exception 'Не удалось подобрать свободный номер транзакции за 3 попытки — повторите';
      end if;

      insert into public.wallet_all
             (master, transaction_number, "date", "time", event_type, event, appeal_id, payment_type, amount, status, slice_status, receipt_photo)
      values (v_master, v_tr, v_date, v_time, v_event_type, v_event, v_appeal, v_payment, v_amount, 'неподтверждено', 'unsorted', null)
      returning id into v_new_id;

      v_inserted := v_inserted + 1;
      v_applied := v_applied || jsonb_build_array(jsonb_build_object(
        'op', 'вставить', 'master', v_master, 'id', v_new_id, 'transaction_number', v_tr,
        'event_type', v_event_type, 'event', v_event, 'amount', v_amount, 'payment_type', v_payment, 'appeal_id', v_appeal
      ));

    elsif v_kind = 'метка' then
      v_tr := nullif(btrim(v_op->>'transaction_number'), '');
      v_reason := nullif(btrim(v_op->>'reason'), '');
      if v_tr is null or v_reason is null then
        raise exception 'Кошельки, операция %: у метки нужны transaction_number и reason', v_n;
      end if;

      select to_jsonb(w) into v_before from public.wallet_all w
       where w.master = v_master and w.id = v_id and w.transaction_number = v_tr
       for update;
      if v_before is null then
        -- Строку уже срезали (она в walletfinal_) — метка не нужна, строка-разница её покрывает
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'what', 'метка', 'master', v_master, 'id', v_id, 'transaction_number', v_tr,
          'why', 'строки в кошельке уже нет (срезана): метку не ставим, её покрывает строка-разница'
        ));
      elsif exists (
        select 1 from public.wallet_holds h
        where h.master = v_master and h.transaction_number = v_tr and h.released_at is null
      ) then
        -- Метка на эту строку уже стоит (прошлая правка договора или повтор вызова): вторую не ставим, строка и так под блоком среза.
        -- Строка кошелька выше взята под замок, поэтому два вызова разом не проскочат между проверкой и вставкой
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'what', 'метка', 'master', v_master, 'id', v_id, 'transaction_number', v_tr,
          'why', 'на эту строку метка уже стоит — вторую не ставим'
        ));
      else
        insert into public.wallet_holds (master, wallet_id, transaction_number, dogovor_number, reason, created_by, created_by_name)
        values (v_master, v_id, v_tr, p_dogovor_number, v_reason, v_uid, v_name);
        v_holds := v_holds + 1;
        v_applied := v_applied || jsonb_build_array(jsonb_build_object(
          'op', 'метка', 'master', v_master, 'id', v_id, 'transaction_number', v_tr, 'reason', v_reason
        ));
      end if;

    else
      raise exception 'Кошельки, операция %: неизвестный вид «%»', v_n, coalesce(v_kind, '');
    end if;
  end loop;

  return jsonb_build_object(
    'edited', v_edited,
    'removed', v_removed,
    'inserted', v_inserted,
    'holds', v_holds,
    'applied', v_applied,
    'skipped', v_skipped
  );
end;
$function$;

notify pgrst, 'reload schema';
