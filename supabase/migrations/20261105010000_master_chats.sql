-- ============================================================================
-- Чаты мастера (разбор CRM/28, пункт 13). Слово Яна 05.11: темы не делаем; у мастера несколько своих чатов — замеры,
-- монтажи, просчёты, себес (себестоимость), договоры, касса; менеджер вставляет все ссылки при заведении, мы храним номера.
-- Виды чатов — справочник master_chat_kinds (новый вид = строка, не переделка базы); номера — master_chats
-- (мастер × вид → номер чата; один и тот же чат нельзя повесить дважды). Старое поле masters.tg_chat_id НЕ трогаем: бот
-- шлёт туда как раньше, пока Ян не решит, какой вид чата его заменяет.
-- create_master получает необязательный последний параметр p_chats (jsonb {"zamer": -100…, …}); update_master — поле
-- «chats» в патче (null у вида снимает чат). Запись — только этими функциями (суперадмин); чтение — select у вошедших.
-- Откат: drop function create_master(…12 арг.); вернуть create_master из 20261104210000; drop table master_chats, master_chat_kinds;
--        drop function master_set_chats(text, jsonb), master_chats_json(text).
-- ============================================================================

begin;
set local lock_timeout = '5s';

create table if not exists public.master_chat_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  title text not null check (btrim(title) <> ''),
  group_suffix text not null check (btrim(group_suffix) <> ''),
  hint text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.master_chat_kinds is 'Виды чатов мастера: замеры, монтажи, просчёты, себес, договоры, касса. group_suffix — слово в названии группы: «ИМЯ СЛОВО», капсом (РОМА ЗАМЕР)';

insert into public.master_chat_kinds (key, title, group_suffix, hint, sort_order) values
  ('zamer',    'Замер',    'ЗАМЕР',    'Карточки на замер',                 1),
  ('montazh',  'Монтаж',   'МОНТАЖ',   'Монтажи мастера',                   2),
  ('proschet', 'Просчёт',  'ПРОСЧЕТ',  'Обычные просчёты',                  3),
  ('sebes',    'Себес',    'СЕБЕС',    'Себестоимость (просчёты по себесу)', 4),
  ('dogovor',  'Договоры', 'ДОГОВОРЫ', 'Договоры мастера',                   5),
  ('kassa',    'Касса',    'КАССА',    'Сводки по кошельку мастера',        6)
on conflict (key) do nothing;

create table if not exists public.master_chats (
  id bigint generated always as identity primary key,
  master text not null references public.masters(key) on update restrict on delete cascade,
  kind text not null references public.master_chat_kinds(key) on update restrict on delete restrict,
  chat_id bigint not null check (chat_id <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (master, kind),
  unique (chat_id)
);
comment on table public.master_chats is 'Чаты мастера по видам: мастер × вид → номер чата Telegram (супергруппа -100…). Пишут только create_master/update_master';

alter table public.master_chat_kinds enable row level security;
alter table public.master_chats enable row level security;
drop policy if exists master_chat_kinds_select_authenticated on public.master_chat_kinds;
create policy master_chat_kinds_select_authenticated on public.master_chat_kinds for select to authenticated using (true);
drop policy if exists master_chats_select_authenticated on public.master_chats;
create policy master_chats_select_authenticated on public.master_chats for select to authenticated using (true);
revoke all on public.master_chat_kinds, public.master_chats from anon, public, authenticated;
grant select on public.master_chat_kinds, public.master_chats to authenticated;
grant all on public.master_chat_kinds, public.master_chats to service_role;

-- Чаты мастера как jsonb-массив для ответа функций
create or replace function public.master_chats_json(p_key text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'chat_id', c.chat_id) order by k.sort_order), '[]'::jsonb)
    from public.master_chats c join public.master_chat_kinds k on k.key = c.kind
   where c.master = p_key
$function$;

-- Внутренняя: записать чаты мастера. p_chats — объект {вид: номер | null}. Вызывать только из create_master / update_master
-- (проверка суперадмина уже сделана там). Всё или ничего вместе с вызвавшей функцией.
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
  end loop;
end;
$function$;

-- create_master получает последний параметр p_chats: старую сигнатуру убираем (иначе два варианта и неоднозначный вызов)
drop function if exists public.create_master(text, text, text, bigint, text, text, text, text, text, numeric, numeric);

-- 1. Завести мастера -----------------------------------------------------------
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

  if p_chats is not null then
    perform public.master_set_chats(v_key, p_chats);
  end if;

  return jsonb_build_object('ok', true, 'master', to_jsonb(v_row), 'settings_id', v_settings_id,
                            'chats', public.master_chats_json(v_key));
end;
$function$;

-- 2. Сохранить карточку мастера ------------------------------------------------
-- p_patch — объект с полями; каких нет — не трогаются. Ключ, имя, «работает» и порядок не правятся (ключ и имя —
-- навсегда; «работает» — отдельная функция с окном «что закрыть»). Ответ — строки masters и settings_fuel_masters
-- ПОСЛЕ записи (повторное чтение), чтобы экран показал то, что реально записано.
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
  if p_patch ? 'tg_chat_id' then
    v_val := p_patch -> 'tg_chat_id';
    if jsonb_typeof(v_val) = 'null' then
      v_chat := null;
    elsif jsonb_typeof(v_val) = 'number' and (v_val #>> '{}') ~ '^-?[0-9]{1,19}$' then
      v_chat := (v_val #>> '{}')::bigint;
    else
      raise exception 'Номер чата Telegram — целое число' using hint = 'ЧАТ_НЕВЕРЕН';
    end if;
    if v_chat = 0 then
      raise exception 'Номер чата Telegram не может быть нулём' using hint = 'ЧАТ_НЕВЕРЕН';
    end if;
    if v_chat is not null and exists (select 1 from public.masters m where m.tg_chat_id = v_chat and m.key <> v_key) then
      raise exception 'Этот чат уже подключён к другому мастеру' using hint = 'ЧАТ_ЗАНЯТ';
    end if;
    update public.masters m set tg_chat_id = v_chat where m.key = v_key;
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

revoke all on function public.master_chats_json(text) from public, anon;
grant execute on function public.master_chats_json(text) to authenticated, service_role;
revoke all on function public.master_set_chats(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_master(text, text, text, bigint, text, text, text, text, text, numeric, numeric, jsonb) from public, anon;
grant execute on function public.create_master(text, text, text, bigint, text, text, text, text, text, numeric, numeric, jsonb) to authenticated, service_role;
revoke all on function public.update_master(text, jsonb) from public, anon;
grant execute on function public.update_master(text, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
