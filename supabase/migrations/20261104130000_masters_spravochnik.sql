-- Список мастеров в базе (таблица masters). Разбор CRM/28, пункт 2.
-- Было: мастера перечислены в 11 местах кода CRM, 6 местах сервера и в трёх местах базы (функции, CHECK), общего списка нет.
-- Стало: одна таблица — единственный источник: ключ, имя, активен, порядок, цвет, чат Telegram.
-- Здесь только справочник: функции денег, таблицы кошельков и списки в CRM и на сервере не тронуты (следующие пункты).
-- Запись — только функциями базы (create_master — пункт 3); вошедшие в CRM таблицу только читают.
begin;
set local lock_timeout = '5s';

create table public.masters (
  key text primary key
    constraint masters_key_format check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name text not null
    constraint masters_name_not_blank check (btrim(name) <> ''),
  is_active boolean not null default true,
  sort_order integer not null,
  fuel_sort_order integer not null,
  color text not null
    constraint masters_color_format check (color ~ '^#[0-9a-f]{6}$'),
  tg_chat_id bigint,
  tg_key text
    constraint masters_tg_key_format check (tg_key is null or tg_key ~ '^[A-ZА-Я0-9_]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint masters_name_unique unique (name)
);

create unique index masters_tg_chat_id_unique on public.masters (tg_chat_id) where tg_chat_id is not null;
create unique index masters_tg_key_unique on public.masters (tg_key) where tg_key is not null;

comment on table public.masters is 'Справочник мастеров: единственный источник списка. Ключ (латиница) и имя после создания не меняются; ушедшего не стираем, снимаем is_active.';
comment on column public.masters.key is 'Ключ латиницей: суффикс таблиц wallet_/walletfinal_/toplivo_, не меняется';
comment on column public.masters.sort_order is 'Порядок в кошельках и общих списках';
comment on column public.masters.fuel_sort_order is 'Порядок в разделе «Топливо» (в CRM он отличается от кошельков)';
comment on column public.masters.color is 'Цвет мастера, hex: оттенок 600 палитры Tailwind, как в CRM';
comment on column public.masters.tg_key is 'Ключ для Telegram: имя без «ё» в верхнем регистре, по нему сервер ищет чат';

create or replace function public.masters_keep_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key is distinct from old.key then
    raise exception 'masters.key менять нельзя (мастер %)', old.key using errcode = '23514';
  end if;
  if new.name is distinct from old.name then
    raise exception 'masters.name менять нельзя (мастер %)', old.key using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.masters_keep_identity() from public, anon, authenticated;

create trigger masters_keep_identity
  before update on public.masters
  for each row execute function public.masters_keep_identity();

create trigger masters_updated_at
  before update on public.masters
  for each row execute function public.update_updated_at_column();

alter table public.masters enable row level security;
revoke all on table public.masters from public, anon, authenticated;
grant select on table public.masters to authenticated;
grant all on table public.masters to service_role;

create policy masters_select_authenticated on public.masters
  for select to authenticated using (true);

insert into public.masters (key, name, sort_order, fuel_sort_order, color, tg_chat_id, tg_key) values
  ('anton',      'Антон',    1,  2, '#2563eb', -1002314044639, 'АНТОН'),
  ('lesha',      'Леша',     2,  4, '#16a34a', -1002504122184, 'ЛЕША'),
  ('roma',       'Рома',     3,  5, '#9333ea', -1001962103813, 'РОМА'),
  ('timur',      'Тимур',    4,  7, '#dc2626', -1001948267386, 'ТИМУР'),
  ('semen',      'Семён',    5,  6, '#ea580c', -1001907257943, 'СЕМЕН'),
  ('vladimir',   'Владимир', 6,  8, '#0d9488', -1002395698353, 'ВЛАДИМИР'),
  ('vyacheslav', 'Вячеслав', 7,  9, '#4f46e5', null,           'ВЯЧЕСЛАВ'),
  ('aleksei',    'Алексей',  8,  1, '#db2777', -1002474207557, 'АЛЕКСЕЙ'),
  ('evgeniy',    'Евгений',  9,  3, '#0891b2', -1002532739628, 'ЕВГЕНИЙ'),
  ('dima',       'Дима',     10, 10, '#d97706', -1002882550504, 'ДИМА'),
  ('daniil',     'Даниил',   11, 11, '#059669', -1002573504528, 'ДАНИИЛ'),
  ('yglov',      'Углов',    12, 12, '#7c3aed', -1002762072704, 'УГЛОВ');

commit;
