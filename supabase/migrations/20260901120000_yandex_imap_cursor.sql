-- ============================================================================
-- Закладка чтения Яндекс.Почты: докуда дочитали.
--
-- Одна строка на папку. Нужна, чтобы после перезапуска сервера чтение
-- продолжалось с того же места, а не с «писем за сегодня»: именно из-за
-- окна «за сегодня» ветка Gmail теряет письма при простое дольше суток.
--
-- Пока таблицы нет, модуль работает с закладкой в памяти и пишет об этом
-- в лог — поэтому миграция ничего не ломает и применяется в любой момент.
-- ============================================================================

create table if not exists public.yandex_imap_cursor (
  id            text primary key,
  uid_validity  text,
  last_uid      bigint not null default 0,
  updated_at    timestamptz not null default now()
);

comment on table public.yandex_imap_cursor is
  'Закладка чтения почты Яндекса по IMAP: поколение ящика и последний разобранный номер письма';
comment on column public.yandex_imap_cursor.uid_validity is
  'Поколение ящика. Сменилось — прежние номера недействительны, нужна пересверка';
comment on column public.yandex_imap_cursor.last_uid is
  'Номер последнего разобранного письма';

alter table public.yandex_imap_cursor enable row level security;

-- Доступ только у служебного ключа сервера: политик для anon и authenticated нет
-- намеренно, как у gmail_oauth_tokens и gmail_processed_messages.
