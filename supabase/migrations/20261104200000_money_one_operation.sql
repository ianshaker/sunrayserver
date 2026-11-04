-- ============================================================================
-- Деньги мастеров — остальные места записи одной операцией (разбор CRM/28, пункт 6, после среза).
-- Было: браузер пишет несколькими запросами подряд; обрыв, повтор или двое менеджеров разом оставляли
-- деньги наполовину (аудит 04.11.2026, audit-dengi.md пп. 2–5). Стало — четыре функции, каждая «всё или ничего»:
--   1. pay_fuel_day              — выплата бензина за день: проводка в кошелёк + пометка поездок «выплачено»;
--   2. transfer_wallet_transactions — перенос проводок другому мастеру (и сдвиг даты — перенос монтажа);
--   3. split_wallet_transaction  — разделение проводки на две части;
--   4. add_contract_money        — аванс и замер при создании договора (зовётся ПОСЛЕ записи договора).
-- Общее: security invoker, зовёт только вошедший (authenticated), anon закрыт; номер проводки выдаёт база
-- (wallet_new_transaction_number — как у среза); дата и время записи — по Москве; строки под замком (for update).
-- Логика прежняя, где браузер её уже имел; отличия названы у каждой функции («Отличие от браузера»).
-- Откат: drop function public.<имя>(…) — таблицы не менялись.
-- ============================================================================

begin;
set local lock_timeout = '5s';

-- 1. Выплата бензина ---------------------------------------------------------
-- Отличие от браузера: (а) выбор и пометка поездок и запись проводки — под одним замком; двое менеджеров разом —
-- второй получает отказ «уже выплачено»; (б) день, где часть поездок уже выплачена, не платится заново целиком
-- (браузер платил весь день и затирал комментарий выплаченных) — отказ с подсказкой; (в) дата проводки — день
-- выплаты по Москве (браузер ставил дату по UTC).
create or replace function public.pay_fuel_day(
  p_master text,
  p_date date,
  p_ids integer[],
  p_amount numeric,
  p_description text
)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamp := date_trunc('second', clock_timestamp() at time zone 'Europe/Moscow');
  v_ids integer[];
  v_found integer;
  v_paid integer;
  v_amount numeric;
  v_number text;
  v_row_id integer;
  v_rows integer;
begin
  if v_uid is null then
    raise exception 'Войдите в CRM, чтобы оформить выплату бензина';
  end if;
  if p_master is null or not exists (select 1 from public.masters m where m.key = p_master) then
    raise exception 'Выплата бензина: мастер «%» не из списка кошельков', coalesce(p_master, '');
  end if;
  if p_date is null then
    raise exception 'Выплата бензина: не указан день поездок';
  end if;
  if p_amount is null then
    raise exception 'Выплата бензина: не указана сумма';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Выплата бензина: нет текста проводки';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_ids) x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Выплата бензина: нет поездок к выплате';
  end if;

  -- Замок: день мастера. Второй менеджер ждёт первого и видит уже выплаченное
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended('fuel_pay:' || p_master || ':' || p_date::text, 0));
  select count(*), count(*) filter (where t.status = 'выплачено')
    into v_found, v_paid
    from public.toplivo_all t
   where t.master = p_master and t.date = p_date and t.id = any (v_ids);
  perform 1 from public.toplivo_all t where t.master = p_master and t.id = any (v_ids) order by t.id for update;

  if v_found <> array_length(v_ids, 1) then
    raise exception 'Выплата бензина: поездки изменились, обновите страницу'
      using hint = 'ПОЕЗДКИ_ИЗМЕНИЛИСЬ';
  end if;
  if v_paid = v_found then
    raise exception 'Выплата за этот день уже была произведена'
      using hint = 'УЖЕ_ВЫПЛАЧЕНО';
  end if;
  if v_paid > 0 then
    raise exception 'Часть поездок этого дня уже выплачена — выплату за такой день оформляет Глеб'
      using hint = 'ДЕНЬ_ЧАСТИЧНО_ВЫПЛАЧЕН';
  end if;

  v_amount := -round(abs(p_amount));
  v_number := public.wallet_new_transaction_number();
  insert into public.wallet_all (master, transaction_number, date, time, event_type, event, payment_type, amount, status, slice_status)
  values (p_master, v_number, v_now::date, v_now::time, 'Выплата по бензину', btrim(p_description), 'Наличные', v_amount,
          'неподтверждено', 'unsorted')
  returning id into v_row_id;

  update public.toplivo_all t
     set status = 'выплачено', comment = 'Выплата по бензину, транзакция №' || v_number
   where t.master = p_master and t.id = any (v_ids) and t.status = 'не выплачено';
  get diagnostics v_rows = row_count;
  if v_rows <> v_found then
    raise exception 'Выплата бензина: помечено поездок %, ожидали %', v_rows, v_found;
  end if;

  return jsonb_build_object('ok', true, 'transaction_number', v_number, 'wallet_id', v_row_id, 'amount', v_amount, 'marked', v_rows);
end;
$function$;

-- 2. Перенос проводок другому мастеру ----------------------------------------
-- Отличие от браузера: (а) копия и удаление оригинала — одной операцией: обрыв не оставляет строку у двоих;
-- (б) переносятся только свободные строки («Несортированные» — их и показывает окно); (в) строка с активной
-- меткой «договор изменён» не переносится (копия потеряла бы метку, и срез перестал бы её ждать).
-- p_new_date — для переноса монтажа: дата переносимых строк заменяется, остальное копируется.
create or replace function public.transfer_wallet_transactions(
  p_from text,
  p_to text,
  p_ids integer[],
  p_new_date date default null
)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_ids integer[];
  v_found integer;
  v_bad integer;
  v_held integer;
  v_row record;
  v_number text;
  v_new_id integer;
  v_rows integer;
  v_moved jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Войдите в CRM, чтобы перенести транзакцию';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Перенос: нужны два разных мастера';
  end if;
  if (select count(*) from public.masters m where m.key in (p_from, p_to)) <> 2 then
    raise exception 'Перенос: мастер не из списка кошельков';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_ids) x where x is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Перенос: не выбрано ни одной транзакции';
  end if;

  perform set_config('lock_timeout', '5s', true);
  select count(*), count(*) filter (where w.slice_status <> 'unsorted')
    into v_found, v_bad
    from (select w.* from public.wallet_all w where w.master = p_from and w.id = any (v_ids) order by w.id for update) w;
  if v_found <> array_length(v_ids, 1) then
    raise exception 'Перенос: транзакция изменилась или её уже перенесли, обновите страницу'
      using hint = 'СТРОКА_ИЗМЕНИЛАСЬ';
  end if;
  if v_bad > 0 then
    raise exception 'Перенос: переносить можно только транзакции из «Сортировки»'
      using hint = 'СТРОКА_НЕ_СВОБОДНА';
  end if;
  select count(*) into v_held
    from public.wallet_all w
    join public.wallet_holds h on h.master = w.master and h.released_at is null
     and upper(btrim(h.transaction_number)) = upper(btrim(w.transaction_number))
   where w.master = p_from and w.id = any (v_ids);
  if v_held > 0 then
    raise exception 'Перенос: у транзакции метка «договор изменён» — сначала снимите её'
      using hint = 'СТРОКА_С_МЕТКОЙ';
  end if;

  for v_row in select * from public.wallet_all w where w.master = p_from and w.id = any (v_ids) order by w.id loop
    v_number := public.wallet_new_transaction_number();
    insert into public.wallet_all (master, transaction_number, date, time, event_type, event, appeal_id, payment_type, amount,
                                   receipt_photo, status, slice_status)
    values (p_to, v_number, coalesce(p_new_date, v_row.date), v_row.time, v_row.event_type, v_row.event, v_row.appeal_id,
            v_row.payment_type, v_row.amount, v_row.receipt_photo, v_row.status, v_row.slice_status)
    returning id into v_new_id;
    delete from public.wallet_all w where w.master = p_from and w.id = v_row.id;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'Перенос: исходная строка % не удалилась', v_row.id;
    end if;
    v_moved := v_moved || jsonb_build_array(jsonb_build_object(
      'from_id', v_row.id, 'from_number', v_row.transaction_number, 'to_id', v_new_id, 'to_number', v_number));
  end loop;

  return jsonb_build_object('ok', true, 'moved', v_moved);
end;
$function$;

-- 3. Разделение проводки на две части -----------------------------------------
-- Отличие от браузера: (а) обе половины пишутся одной операцией (раньше при сбое вставки первая часть оставалась
-- уменьшенной); (б) строка должна быть той же суммы, что видело окно (p_expected), свободной («Сортировка») и без метки
-- «договор изменён» (часть 2 без метки ушла бы в срез); (в) сумма частей сверяется с оригиналом с допуском 0,01, как в браузере. Знаки и нули частей проверяет окно.
create or replace function public.split_wallet_transaction(
  p_master text,
  p_id integer,
  p_expected numeric,
  p_first_amount numeric,
  p_first_payment text,
  p_second_amount numeric,
  p_second_payment text
)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_orig public.wallet_all%rowtype;
  v_number text;
  v_second_id integer;
begin
  if v_uid is null then
    raise exception 'Войдите в CRM, чтобы разделить транзакцию';
  end if;
  if p_master is null or not exists (select 1 from public.masters m where m.key = p_master) then
    raise exception 'Разделение: мастер «%» не из списка кошельков', coalesce(p_master, '');
  end if;
  if p_id is null or p_expected is null or p_first_amount is null or p_second_amount is null
     or coalesce(btrim(p_first_payment), '') = '' or coalesce(btrim(p_second_payment), '') = '' then
    raise exception 'Разделение: не хватает данных (строка, суммы или способы оплаты)';
  end if;

  perform set_config('lock_timeout', '5s', true);
  select * into v_orig from public.wallet_all w where w.master = p_master and w.id = p_id for update;
  if not found or v_orig.amount <> p_expected then
    raise exception 'Разделение: транзакция изменилась или её уже нет, обновите страницу'
      using hint = 'СТРОКА_ИЗМЕНИЛАСЬ';
  end if;
  if v_orig.slice_status <> 'unsorted' then
    raise exception 'Разделение: делить можно только транзакции из «Сортировки»'
      using hint = 'СТРОКА_НЕ_СВОБОДНА';
  end if;
  if exists (select 1 from public.wallet_holds h
              where h.master = p_master and h.released_at is null
                and upper(btrim(h.transaction_number)) = upper(btrim(v_orig.transaction_number))) then
    raise exception 'Разделение: у транзакции метка «договор изменён» — сначала снимите её'
      using hint = 'СТРОКА_С_МЕТКОЙ';
  end if;
  if abs(p_first_amount + p_second_amount - v_orig.amount) > 0.01 then
    raise exception 'Разделение: сумма частей не равна сумме транзакции'
      using hint = 'СУММА_НЕ_СХОДИТСЯ';
  end if;

  v_number := public.wallet_new_transaction_number();
  insert into public.wallet_all (master, transaction_number, date, time, event_type, event, appeal_id, payment_type, amount,
                                 receipt_photo, status, slice_status)
  values (p_master, v_number, v_orig.date, v_orig.time, v_orig.event_type,
          btrim(coalesce(v_orig.event, '') || ' (часть 2/2)'), v_orig.appeal_id, btrim(p_second_payment), p_second_amount,
          v_orig.receipt_photo, v_orig.status, v_orig.slice_status)
  returning id into v_second_id;

  update public.wallet_all w
     set amount = p_first_amount, payment_type = btrim(p_first_payment),
         event = btrim(coalesce(v_orig.event, '') || ' (часть 1/2)')
   where w.master = p_master and w.id = p_id;

  return jsonb_build_object('ok', true, 'first_id', p_id, 'first_number', v_orig.transaction_number,
                            'second_id', v_second_id, 'second_number', v_number);
end;
$function$;

-- 4. Аванс и замер при создании договора -------------------------------------
-- Зовётся ПОСЛЕ записи договора (раньше деньги шли до договора, откат их не удалял, повтор давал вторую пару).
-- Договор, номер и обращение база берёт из строки dogovornew по id, не от клиента. Повторный вызов того же договора
-- не пишет вторую пару: возвращает уже записанные проводки (already=true); ищет и в срезах, и по «(часть N/2)». Сбой — откат обеих проводок.
-- Статус проводок — как в браузере: «подтверждено» при «Наличные» или «Безнал», иначе «неподтверждено» (одно на обе).
-- Отличие от браузера: дата проводок — по Москве.
create or replace function public.add_contract_money(
  p_contract_id integer,
  p_master text,
  p_advance numeric,
  p_advance_payment text,
  p_measurement numeric
)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamp := date_trunc('second', clock_timestamp() at time zone 'Europe/Moscow');
  v_number text;
  v_appeal text;
  v_payment text := coalesce(nullif(btrim(p_advance_payment), ''), 'Наличные');
  v_status text;
  v_adv_event text;
  v_mes_event text;
  v_adv jsonb;
  v_mes jsonb;
  v_id integer;
  v_tr text;
  v_already boolean := false;
begin
  if v_uid is null then
    raise exception 'Войдите в CRM, чтобы записать деньги договора';
  end if;
  if p_master is null or not exists (select 1 from public.masters m where m.key = p_master) then
    raise exception 'Деньги договора: мастер «%» не из списка кошельков', coalesce(p_master, '');
  end if;
  if p_contract_id is null or p_advance is null or p_measurement is null then
    raise exception 'Деньги договора: не хватает данных (договор, аванс или замер)';
  end if;
  if p_advance < 0 then
    raise exception 'Деньги договора: аванс не может быть отрицательным';
  end if;
  if p_advance = 0 and p_measurement = 0 then
    raise exception 'Деньги договора: должна быть указана либо сумма аванса, либо сумма замера';
  end if;

  perform set_config('lock_timeout', '5s', true);
  -- Замок на договор: повтор и параллельный вызов ждут первого
  select d.dogovor_number, d.appeal_id into v_number, v_appeal
    from public.dogovornew d where d.id = p_contract_id for no key update;
  if not found then
    raise exception 'Договор не найден: обновите страницу';
  end if;
  if coalesce(btrim(v_number), '') = '' or coalesce(btrim(v_appeal), '') = '' then
    raise exception 'Деньги договора: у договора нет номера или обращения';
  end if;

  v_status := case when v_payment in ('Наличные', 'Безнал') then 'подтверждено' else 'неподтверждено' end;
  v_adv_event := 'Заключение договора №' || v_number;
  v_mes_event := 'Оплата за замер по договору №' || v_number;

  if p_advance > 0 then
    select jsonb_build_object('id', x.id, 'transaction_number', x.transaction_number, 'amount', x.amount) into v_adv
      from (select w.id, w.transaction_number, w.amount from public.wallet_all w
             where w.master = p_master and w.appeal_id = v_appeal and w.event_type = 'Аванс'
               and (w.event = v_adv_event or w.event like v_adv_event || ' (часть %')
            union all
            select f.id, f.transaction_number, f.amount from public.walletfinal_all f
             where f.master = p_master and f.appeal_id = v_appeal and f.event_type = 'Аванс'
               and (f.event = v_adv_event or f.event like v_adv_event || ' (часть %')) x
     limit 1;
    if v_adv is null then
      v_tr := public.wallet_new_transaction_number();
      insert into public.wallet_all (master, transaction_number, date, time, event_type, event, appeal_id, payment_type, amount,
                                     status, slice_status)
      values (p_master, v_tr, v_now::date, v_now::time, 'Аванс', v_adv_event, v_appeal, v_payment, abs(p_advance), v_status, 'unsorted')
      returning id into v_id;
      v_adv := jsonb_build_object('id', v_id, 'transaction_number', v_tr, 'amount', abs(p_advance));
    else
      v_already := true;
    end if;
  end if;

  if p_measurement <> 0 then
    select jsonb_build_object('id', x.id, 'transaction_number', x.transaction_number, 'amount', x.amount) into v_mes
      from (select w.id, w.transaction_number, w.amount from public.wallet_all w
             where w.master = p_master and w.appeal_id = v_appeal and w.event_type = 'Выплата по замеру'
               and (w.event = v_mes_event or w.event like v_mes_event || ' (часть %')
            union all
            select f.id, f.transaction_number, f.amount from public.walletfinal_all f
             where f.master = p_master and f.appeal_id = v_appeal and f.event_type = 'Выплата по замеру'
               and (f.event = v_mes_event or f.event like v_mes_event || ' (часть %')) x
     limit 1;
    if v_mes is null then
      v_tr := public.wallet_new_transaction_number();
      insert into public.wallet_all (master, transaction_number, date, time, event_type, event, appeal_id, payment_type, amount,
                                     status, slice_status)
      values (p_master, v_tr, v_now::date, v_now::time, 'Выплата по замеру', v_mes_event, v_appeal, 'Наличные', -abs(p_measurement),
              v_status, 'unsorted')
      returning id into v_id;
      v_mes := jsonb_build_object('id', v_id, 'transaction_number', v_tr, 'amount', -abs(p_measurement));
    else
      v_already := true;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'already', v_already, 'advance', v_adv, 'measurement', v_mes);
end;
$function$;

-- Права: зовёт только вошедший
revoke all on function public.pay_fuel_day(text, date, integer[], numeric, text) from public, anon;
grant execute on function public.pay_fuel_day(text, date, integer[], numeric, text) to authenticated, service_role;
revoke all on function public.transfer_wallet_transactions(text, text, integer[], date) from public, anon;
grant execute on function public.transfer_wallet_transactions(text, text, integer[], date) to authenticated, service_role;
revoke all on function public.split_wallet_transaction(text, integer, numeric, numeric, text, numeric, text) from public, anon;
grant execute on function public.split_wallet_transaction(text, integer, numeric, numeric, text, numeric, text) to authenticated, service_role;
revoke all on function public.add_contract_money(integer, text, numeric, text, numeric) from public, anon;
grant execute on function public.add_contract_money(integer, text, numeric, text, numeric) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
