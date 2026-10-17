-- ============================================================================
-- Журнал сырых событий Mango (договор «прокси Mango ↔ Render», З5,
-- PLANS/PROXY/02-zashchita-servera/dogovor-proksi-render.md, раздел «Таблица mango_events»).
--
-- Зачем: журнал сырых событий Mango и защита от повторной обработки одного и того же события (повтор
-- из очереди прокси). Это не гарантия «ровно один раз»: обработчик, упавший посередине, вызовут снова.
-- Render пишет событие сюда ДО обработчика, а после ответа обработчика отмечает итог (obrabotano, kod).
-- Ключ klyuch повторился и obrabotano = true — это дубль, обработчик не зовётся; obrabotano = false (прошлый
-- раз 5xx или упали посередине) — обработчик зовётся снова. Колонка vzyato (аренда) — в следующем файле.
--
-- Кто пишет: только Render (service_role). RLS включён, политик нет намеренно — anon и
-- authenticated не видят и не пишут ничего, как у gmail_oauth_tokens и yandex_imap_cursor.
-- Чистка: Render при старте и раз в сутки удаляет строки старше 90 дней
-- (mango.calls.new/zhurnalSobytiy.js).
--
-- Код Render работает и до применения миграции: пока таблицы нет, он пишет ошибку в лог
-- и обрабатывает звонок как раньше. Применять до выкладки сервера (порядок выкатки, п. 1).
-- ============================================================================

create table if not exists public.mango_events (
  id        bigint generated always as identity primary key,
  klyuch    text not null unique,
  path      text not null,
  vid       text,
  sobytie   text,
  entry_id  text,
  call_id   text,
  payload   jsonb not null,
  prinyato  timestamptz,
  zapisano  timestamptz not null default now(),
  podpis    text,
  povtor    boolean not null default false,
  obrabotano boolean not null default false,
  kod       int
);

comment on table public.mango_events is
  'Сырые события Mango (звонки, итоги, записи): журнал и защита от дублей. Пишет только Render, хранится 90 дней';
comment on column public.mango_events.klyuch is
  'sha256 hex от path + перевод строки + строка поля json Mango как пришла. Повтор ключа = дубль события';
comment on column public.mango_events.path is
  'Путь события: /events/call, /events/summary, /events/recording, /events/record/added';
comment on column public.mango_events.vid is
  'call, summary, recording или record_added';
comment on column public.mango_events.sobytie is
  'Для call: call_state, а если есть location, то call_state@location';
comment on column public.mango_events.payload is
  'Разобранный json без vpbx_api_key и sign; не разобрался: {"_syroe": "<строка>"}';
comment on column public.mango_events.prinyato is
  'Когда событие принял прокси (заголовок x-mango-prinyato)';
comment on column public.mango_events.zapisano is
  'Когда Render записал строку; по нему идёт чистка старше 90 дней';
comment on column public.mango_events.podpis is
  'Проверка подписи Mango на прокси: ok, bad или net (нет полей)';
comment on column public.mango_events.povtor is
  'true, если событие дослано из очереди прокси (x-mango-povtor: 1)';

comment on column public.mango_events.obrabotano is
  'true: обработчик ответил кодом меньше 500 (или событие только записано, без обработчика). false: ещё не ответил, упал или ответил 5xx, повтор с тем же ключом обработается снова';
comment on column public.mango_events.kod is
  'HTTP-код ответа обработчика (200 у событий, которые только записаны)';

create index if not exists idx_mango_events_entry_id
  on public.mango_events (entry_id);

create index if not exists idx_mango_events_prinyato
  on public.mango_events (prinyato);

alter table public.mango_events enable row level security;

-- Политик для anon и authenticated нет намеренно: пишет и читает только служебный
-- ключ Render (service_role обходит RLS).
