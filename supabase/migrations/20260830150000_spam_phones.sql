-- ============================================================================
-- Чёрный список телефонов: номера, которые менеджер пометил спамом.
--
-- Зачем: заявку с таким номером удаляют вместе с её строкой в `ids`, и пометка
-- исчезала бы вместе с карточкой. Список живёт отдельно и переживает удаление —
-- в этом весь смысл: один раз помеченный номер больше не создаёт ни заявки,
-- ни сообщения в чат.
--
-- Ключ — только цифры: «79161192981», «+7 916 119-29-81» и «8(916)119-29-81»
-- сводятся к одной строке (normalizePhone в postamails/parsing/phone.js).
--
-- Кто пишет: CRM по кнопке «Спам» (anon-ключ) и сервер при отбое письма (service_role).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.spam_phones (
  phone_digits   TEXT PRIMARY KEY,
  phone_display  TEXT NOT NULL,
  first_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen      TIMESTAMPTZ NULL,
  hits           INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'manager'
    CHECK (source IN ('manager', 'auto')),
  appeal_number  TEXT NULL,
  added_by       TEXT NULL
);

COMMENT ON TABLE public.spam_phones IS
  'Номера, помеченные спамом. Письма с них не заводят заявку и не идут в чат.';

COMMENT ON COLUMN public.spam_phones.phone_digits IS
  'Только цифры — ключ. Любой формат номера сводится сюда.';
COMMENT ON COLUMN public.spam_phones.phone_display IS
  'Номер в виде 8(XXX)XXX-XX-XX — как показывать человеку.';
COMMENT ON COLUMN public.spam_phones.last_seen IS
  'Когда последний раз приходило письмо с этого номера уже после пометки.';
COMMENT ON COLUMN public.spam_phones.hits IS
  'Сколько писем отбито после попадания в список.';
COMMENT ON COLUMN public.spam_phones.source IS
  'manager — пометил человек; auto — задел на будущее, сейчас не используется.';
COMMENT ON COLUMN public.spam_phones.appeal_number IS
  'Из какой карточки помечено — чтобы понять, откуда взялся номер.';

-- Для экрана списка: кто досаждает сильнее всех и кто приходил недавно.
CREATE INDEX IF NOT EXISTS idx_spam_phones_hits
  ON public.spam_phones (hits DESC);

CREATE INDEX IF NOT EXISTS idx_spam_phones_last_seen
  ON public.spam_phones (last_seen DESC NULLS LAST);

ALTER TABLE public.spam_phones ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.spam_phones TO service_role;

-- CRM ходит с публичным anon-ключом — как остальной postamails и mango_calls.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spam_phones TO anon;

DROP POLICY IF EXISTS "anon select spam phones" ON public.spam_phones;
CREATE POLICY "anon select spam phones" ON public.spam_phones
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon insert spam phones" ON public.spam_phones;
CREATE POLICY "anon insert spam phones" ON public.spam_phones
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon update spam phones" ON public.spam_phones;
CREATE POLICY "anon update spam phones" ON public.spam_phones
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon delete spam phones" ON public.spam_phones;
CREATE POLICY "anon delete spam phones" ON public.spam_phones
  FOR DELETE TO anon USING (true);
