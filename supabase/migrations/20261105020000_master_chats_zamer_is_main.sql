-- ============================================================================
-- Слово Яна 05.11: «рабочего чата бота не бывает» — известные чаты мастеров (masters.tg_chat_id) и есть чат «замер».
-- Одна правда: чат «замер» в master_chats; masters.tg_chat_id — его зеркало для бота (сервер читает как раньше).
-- 1. Перенос: у кого tg_chat_id задан — строка master_chats (вид zamer) с тем же номером.
-- 2. master_set_chats: запись/снятие чата «замер» тут же меняет masters.tg_chat_id.
-- 3. create_master / update_master: старый параметр/поле tg_chat_id теперь пишет чат «замер» (старый и новый CRM работают).
-- Откат: вернуть три функции из 20261105010000_master_chats.sql; delete from master_chats where kind = 'zamer'.
-- ============================================================================

begin;
set local lock_timeout = '5s';

create or replace function public.master_set_chats(p_key text, p_chats jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_kind text;
  v_val jsonb;
  v_chat bigint;
  v_holder record;
begin
  if jsonb_typeof(p_chats) is distinct from 'object' then
    raise exception 'Чаты мастера: ждём объект {вид: номер чата}' using hint = 'ЧАТЫ_ФОРМАТ';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('master_chats', 0));
  for v_kind in select jsonb_object_keys(p_chats) loop
    if not exists (select 1 from public.master_chat_kinds k where k.key = v_kind and k.is_active) then
      raise exception 'Нет такого вида чата: «%»', v_kind using hint = 'ВИД_ЧАТА_НЕТ';
    end if;
    v_val := p_chats -> v_kind;
    if jsonb_typeof(v_val) = 'null' then
      delete from public.master_chats where master = p_key and kind = v_kind;
      if v_kind = 'zamer' then
        update public.masters set tg_chat_id = null where key = p_key;
      end if;
      continue;
    end if;
    if jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^-?[0-9]{1,19}$' then
      raise exception 'Номер чата «%» — целое число', v_kind using hint = 'ЧАТ_НЕВЕРЕН';
    end if;
    v_chat := (v_val #>> '{}')::bigint;
    if v_chat = 0 then
      raise exception 'Номер чата «%» не может быть нулём', v_kind using hint = 'ЧАТ_НЕВЕРЕН';
    end if;
    select m.name as mname, k.title as ktitle into v_holder
      from public.master_chats c
      join public.masters m on m.key = c.master
      join public.master_chat_kinds k on k.key = c.kind
     where c.chat_id = v_chat and not (c.master = p_key and c.kind = v_kind);
    if found then
      raise exception 'Этот чат уже подключён: % · %', v_holder.mname, v_holder.ktitle using hint = 'ЧАТ_ЗАНЯТ';
    end if;
    insert into public.master_chats (master, kind, chat_id) values (p_key, v_kind, v_chat)
    on conflict (master, kind) do update set chat_id = excluded.chat_id, updated_at = now();
    -- «замер» — тот самый чат, куда бот шлёт сегодня (masters.tg_chat_id): держим их одним и тем же
    if v_kind = 'zamer' then
      if exists (select 1 from public.masters m where m.tg_chat_id = v_chat and m.key <> p_key) then
        raise exception 'Этот чат уже подключён к другому мастеру' using hint = 'ЧАТ_ЗАНЯТ';
      end if;
      update public.masters set tg_chat_id = v_chat where key = p_key;
    end if;
  end loop;
end;
$function$;

create or replace function public.create_master(
  p_key text,
  p_name text,
  p_color text default null,
  p_tg_chat_id bigint default null,
  p_phone text default null,
  p_address text default null,
  p_place_id text default null,
  p_car_brand text default null,
  p_car_number text default null,
  p_fuel_consumption numeric default null,
  p_fuel_price numeric default null,
  p_chats jsonb default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_norm text;
  v_tg_key text;
  v_color text := lower(nullif(btrim(coalesce(p_color, '')), ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_sort integer;
  v_fuel_sort integer;
  v_row public.masters%rowtype;
  v_settings_id integer;
begin
  if not public.is_superadmin() then
    raise exception 'Мастеров заводит только суперадмин' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  -- Два «Добавить» разом не должны выдать один порядковый номер
  perform pg_advisory_xact_lock(hashtextextended('create_master', 0));

  if v_key !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'Ключ мастера: латиница, цифры и «_», начинается с буквы, 2–31 знак' using hint = 'КЛЮЧ_НЕВЕРЕН';
  end if;
  if exists (select 1 from public.masters m where m.key = v_key) then
    raise exception 'Мастер с ключом «%» уже есть', v_key using hint = 'КЛЮЧ_ЗАНЯТ';
  end if;
  if v_name = '' then
    raise exception 'Не указано имя мастера' using hint = 'ИМЯ_ПУСТО';
  end if;
  v_norm := lower(replace(v_name, 'ё', 'е'));
  if exists (select 1 from public.masters m where lower(replace(m.name, 'ё', 'е')) = v_norm)
     or exists (select 1 from public.settings_fuel_masters s where lower(replace(s.master_name, 'ё', 'е')) = v_norm) then
    raise exception 'Имя «%» уже занято (мастер, склад или СДЭК)', v_name using hint = 'ИМЯ_ЗАНЯТО';
  end if;

  -- Ключ для Telegram: имя без «ё» капсом, пробелы → «_»; сервер ищет чат по нему
  v_tg_key := upper(regexp_replace(replace(replace(v_name, 'Ё', 'Е'), 'ё', 'е'), '\s+', '_', 'g'));
  if v_tg_key !~ '^[A-ZА-Я0-9_]+$' then
    raise exception 'В имени допустимы русские и латинские буквы, цифры и пробел' using hint = 'ИМЯ_СИМВОЛЫ';
  end if;
  if exists (select 1 from public.masters m where m.tg_key = v_tg_key) then
    raise exception 'Имя «%» даёт тот же ключ Telegram, что у другого мастера', v_name using hint = 'ИМЯ_ЗАНЯТО';
  end if;

  if v_color is null then
    v_color := public.master_auto_color();
  elsif v_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'Цвет — hex вида #2563eb' using hint = 'ЦВЕТ_НЕВЕРЕН';
  end if;

  if p_tg_chat_id is not null then
    if p_tg_chat_id = 0 then
      raise exception 'Номер чата Telegram не может быть нулём' using hint = 'ЧАТ_НЕВЕРЕН';
    end if;
    if exists (select 1 from public.masters m where m.tg_chat_id = p_tg_chat_id) then
      raise exception 'Этот чат уже подключён к другому мастеру' using hint = 'ЧАТ_ЗАНЯТ';
    end if;
  end if;
  if p_fuel_consumption is not null and p_fuel_consumption <= 0 then
    raise exception 'Расход топлива должен быть больше нуля' using hint = 'РАСХОД_НЕВЕРЕН';
  end if;
  if p_fuel_price is not null and p_fuel_price <= 0 then
    raise exception 'Цена топлива должна быть больше нуля' using hint = 'ЦЕНА_НЕВЕРНА';
  end if;

  select coalesce(max(m.sort_order), 0) + 1, coalesce(max(m.fuel_sort_order), 0) + 1
    into v_sort, v_fuel_sort from public.masters m;

  insert into public.masters (key, name, is_active, sort_order, fuel_sort_order, color, tg_chat_id, tg_key, phone)
  values (v_key, v_name, true, v_sort, v_fuel_sort, v_color, p_tg_chat_id, v_tg_key, v_phone)
  returning * into v_row;

  insert into public.settings_fuel_masters (master_name, address, place_id, car_brand, car_number, fuel_consumption, fuel_price)
  values (v_name, nullif(btrim(coalesce(p_address, '')), ''), nullif(btrim(coalesce(p_place_id, '')), ''),
          nullif(btrim(coalesce(p_car_brand, '')), ''), nullif(btrim(coalesce(p_car_number, '')), ''),
          p_fuel_consumption, p_fuel_price)
  returning id into v_settings_id;

  if p_chats is not null or p_tg_chat_id is not null then
    perform public.master_set_chats(v_key,
      case when p_tg_chat_id is not null and jsonb_typeof(coalesce(p_chats, '{}'::jsonb)) = 'object'
                and not (coalesce(p_chats, '{}'::jsonb) ? 'zamer')
           then coalesce(p_chats, '{}'::jsonb) || jsonb_build_object('zamer', p_tg_chat_id)
           else coalesce(p_chats, '{}'::jsonb) end);
  end if;

  return jsonb_build_object('ok', true, 'master', to_jsonb(v_row), 'settings_id', v_settings_id,
                            'chats', public.master_chats_json(v_key));
end;
$function$;

create or replace function public.update_master(p_key text, p_patch jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_master_fields constant text[] := array['phone', 'tg_chat_id', 'color'];
  c_fuel_fields constant text[] := array['address', 'place_id', 'car_brand', 'car_number', 'fuel_consumption', 'fuel_price'];
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_name text;
  v_field text;
  v_val jsonb;
  v_txt text;
  v_chat bigint;
  v_num numeric;
  v_row public.masters%rowtype;
  v_settings jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'Карточку мастера правит только суперадмин' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Нечего сохранять: ждём объект с полями';
  end if;
  perform set_config('lock_timeout', '5s', true);

  select m.name into v_name from public.masters m where m.key = v_key for update;
  if not found then
    raise exception 'Мастер «%» не найден', v_key using hint = 'МАСТЕР_НЕ_НАЙДЕН';
  end if;

  for v_field in select jsonb_object_keys(p_patch) loop
    if v_field <> all (c_master_fields || c_fuel_fields || array['chats']) then
      raise exception 'Поле «%» нельзя менять (ключ и имя — навсегда, «работает» — отдельное действие)', v_field
        using hint = 'ПОЛЕ_НЕЛЬЗЯ';
    end if;
  end loop;

  -- masters
  if p_patch ? 'phone' then
    v_val := p_patch -> 'phone';
    v_txt := case when jsonb_typeof(v_val) = 'null' then null else nullif(btrim(v_val #>> '{}'), '') end;
    update public.masters m set phone = v_txt where m.key = v_key;
  end if;
  if p_patch ? 'color' then
    v_txt := lower(btrim(coalesce(p_patch ->> 'color', '')));
    if v_txt !~ '^#[0-9a-f]{6}$' then
      raise exception 'Цвет — hex вида #2563eb' using hint = 'ЦВЕТ_НЕВЕРЕН';
    end if;
    update public.masters m set color = v_txt where m.key = v_key;
  end if;
  -- старое поле tg_chat_id = чат «замер»: пишем через master_set_chats (одна правда); если в этом же патче есть chats.zamer — он главнее
  if p_patch ? 'tg_chat_id'
     and not (p_patch ? 'chats' and jsonb_typeof(p_patch -> 'chats') = 'object' and (p_patch -> 'chats') ? 'zamer') then
    perform public.master_set_chats(v_key, jsonb_build_object('zamer', p_patch -> 'tg_chat_id'));
  end if;

  if p_patch ? 'chats' then
    perform public.master_set_chats(v_key, p_patch -> 'chats');
  end if;

  -- settings_fuel_masters (строку заводит create_master; нет её — создаём пустую, как у Вячеслава)
  if exists (select 1 from jsonb_object_keys(p_patch) k where k = any (c_fuel_fields)) then
    insert into public.settings_fuel_masters (master_name) values (v_name) on conflict (master_name) do nothing;
    foreach v_field in array c_fuel_fields loop
      continue when not (p_patch ? v_field);
      v_val := p_patch -> v_field;
      if v_field in ('fuel_consumption', 'fuel_price') then
        if jsonb_typeof(v_val) = 'null' then
          v_num := null;
        elsif jsonb_typeof(v_val) = 'number' then
          v_num := (v_val #>> '{}')::numeric;
          if v_num <= 0 then
            if v_field = 'fuel_price' then
              raise exception 'Цена топлива должна быть больше нуля' using hint = 'ЦЕНА_НЕВЕРНА';
            end if;
            raise exception 'Расход топлива должен быть больше нуля' using hint = 'РАСХОД_НЕВЕРЕН';
          end if;
        else
          raise exception 'Поле «%» — число', v_field using hint = 'ЧИСЛО_НЕВЕРНО';
        end if;
        execute format('update public.settings_fuel_masters set %I = $1 where master_name = $2', v_field) using v_num, v_name;
      else
        v_txt := case when jsonb_typeof(v_val) = 'null' then null else nullif(btrim(v_val #>> '{}'), '') end;
        execute format('update public.settings_fuel_masters set %I = $1 where master_name = $2', v_field) using v_txt, v_name;
      end if;
    end loop;
  end if;

  select * into v_row from public.masters m where m.key = v_key;
  select to_jsonb(s) into v_settings from public.settings_fuel_masters s where s.master_name = v_name;
  return jsonb_build_object('ok', true, 'master', to_jsonb(v_row), 'settings', v_settings,
                            'chats', public.master_chats_json(v_key));
end;
$function$;

insert into public.master_chats (master, kind, chat_id)
select m.key, 'zamer', m.tg_chat_id from public.masters m where m.tg_chat_id is not null
on conflict (master, kind) do nothing;

revoke all on function public.master_set_chats(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_master(text, text, text, bigint, text, text, text, text, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.create_master(text, text, text, bigint, text, text, text, text, text, numeric, numeric, jsonb) to authenticated, service_role;
revoke all on function public.update_master(text, jsonb) from public, anon;
grant execute on function public.update_master(text, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
