-- ============================================================================
-- Каталог изделий и тканей заводов для КП компаниям: шесть таблиц и закрытый бакет.
--
-- Зачем: «Добавить позицию» в генераторе КП становится каталогом — завод → система →
-- характеристики → ткани → фото и схемы. Структуру принял Ян 23.10.2026 («да, примерно так.
-- Старт»), миграцию и шесть таблиц разрешил там же. Замысел и схема —
-- PLANS/CRM/22-kp-polnocennye/_syroe/08-katalog-izdeliy-zamysel.md, разведка заводов —
-- _syroe/09-razvedka-zavodov.md.
--
-- Что НЕ делает: данных не добавляет (таблицы пустые), файлы не качает, старые таблицы
-- (amigo_*, estimate_product_info, lm_decor_collections, vertical_blind_materials,
-- factory_pass) не трогает. Цены не здесь: калькуляторы Amigo остаются, связь с ними и со
-- сметой — через kp_systems.our_product_key (ключ PRODUCT_LABELS).
--
-- Доступ как у соседних таблиц CRM: RLS включён, роль authenticated (менеджеры CRM — одно
-- лицо) читает и пишет всё, anon (публичный ключ) — ничего, service_role (Render) обходит RLS.
-- Бакет kp-catalog закрытый: фото и тексты заводов — их права, наружу не раздаём; в PDF КП
-- файлы кладёт сервер ключом service_role.
--
-- Откат: таблицы пустые — DROP TABLE public.kp_files, kp_system_fabrics, kp_system_specs,
-- kp_fabrics, kp_systems, kp_factories; бакет — удалить через Storage API, когда в нём пусто.
-- ============================================================================

BEGIN;

-- 1. Заводы ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kp_factories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  site_url       text,
  city           text,
  show_to_client boolean NOT NULL DEFAULT false,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kp_factories IS
  'Заводы-поставщики систем и тканей (Amigo, Интерстиль, Кортин…) для каталога КП';
COMMENT ON COLUMN public.kp_factories.site_url IS
  'Публичный сайт завода. Логины и пароли кабинетов здесь не хранятся (они в factory_pass)';
COMMENT ON COLUMN public.kp_factories.show_to_client IS
  'Показывать ли название завода клиенту в КП. По умолчанию нет';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kp_factories_name
  ON public.kp_factories (lower(name));

-- 2. Системы и изделия -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kp_systems (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      uuid NOT NULL REFERENCES public.kp_factories (id) ON DELETE RESTRICT,
  code            text NOT NULL,
  name            text NOT NULL,
  family          text,
  our_product_key text,
  description     text,
  min_width_mm    integer,
  max_width_mm    integer,
  min_height_mm   integer,
  max_height_mm   integer,
  max_area_m2     numeric(6, 2),
  warranty        text,
  source_url      text,
  source          text NOT NULL DEFAULT 'manual',
  active          boolean NOT NULL DEFAULT true,
  sort            integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kp_systems_source_check CHECK (source IN ('site', 'pdf', 'manual')),
  CONSTRAINT kp_systems_width_check CHECK (
    min_width_mm IS NULL OR max_width_mm IS NULL OR min_width_mm <= max_width_mm),
  CONSTRAINT kp_systems_height_check CHECK (
    min_height_mm IS NULL OR max_height_mm IS NULL OR min_height_mm <= max_height_mm)
);

COMMENT ON TABLE public.kp_systems IS
  'Системы и изделия заводов: MINI, UNI 2, Уни-2, BB11… Параметры — строками в kp_system_specs';
COMMENT ON COLUMN public.kp_systems.code IS
  'Короткое обозначение завода: MINI, UNI 2, BB11. Уникально в пределах завода';
COMMENT ON COLUMN public.kp_systems.family IS
  'Семейство: рулонные, зебра, вертикальные, горизонтальные, плиссе, римские, карнизы…';
COMMENT ON COLUMN public.kp_systems.our_product_key IS
  'Ключ нашего изделия из PRODUCT_LABELS сметы (roller_mini, roller_uni2…); по нему связь с ценами и сметой';
COMMENT ON COLUMN public.kp_systems.min_width_mm IS
  'Пределы размеров и гарантия пустые, пока не взяты из PDF завода («Книга продавца», технические каталоги) или введены руками';
COMMENT ON COLUMN public.kp_systems.source IS
  'Откуда данные: site (сайт завода), pdf (каталог завода), manual (ввели руками)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kp_systems_factory_code
  ON public.kp_systems (factory_id, lower(code));

CREATE INDEX IF NOT EXISTS idx_kp_systems_family
  ON public.kp_systems (family);

-- 3. Характеристики систем (строка = один параметр) --------------------------

CREATE TABLE IF NOT EXISTS public.kp_system_specs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id      uuid NOT NULL REFERENCES public.kp_systems (id) ON DELETE CASCADE,
  group_name     text,
  label          text NOT NULL,
  value          text NOT NULL,
  sort           integer NOT NULL DEFAULT 0,
  show_to_client boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kp_system_specs_system_label_key UNIQUE (system_id, label)
);

COMMENT ON TABLE public.kp_system_specs IS
  'Характеристики системы строками «параметр — значение» (Диаметр трубы — 19 мм): набор параметров у заводов разный';
COMMENT ON COLUMN public.kp_system_specs.group_name IS
  'Группа для показа в КП: Управление, Монтаж, Опции…';
COMMENT ON COLUMN public.kp_system_specs.show_to_client IS
  'false — внутренний параметр, в КП клиенту не выводится';

CREATE INDEX IF NOT EXISTS idx_kp_system_specs_system
  ON public.kp_system_specs (system_id, sort);

-- 4. Ткани -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.kp_fabrics (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     uuid NOT NULL REFERENCES public.kp_factories (id) ON DELETE RESTRICT,
  collection     text,
  article        text,
  name           text NOT NULL,
  color          text,
  transparency   text,
  composition    text,
  roll_width_cm  integer,
  weight_gsm     integer,
  thickness_mm   numeric(5, 2),
  care           text,
  country        text,
  certification  text,
  price_category text,
  source_url     text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kp_fabrics IS
  'Ткани заводов: коллекция, цвет, свойства, ценовая категория. Одна строка — один цвет';
COMMENT ON COLUMN public.kp_fabrics.transparency IS
  'Прозрачность словами завода: непрозрачная, полупрозрачная, прозрачная (светопропускание в % у Amigo не даётся)';
COMMENT ON COLUMN public.kp_fabrics.weight_gsm IS
  'Вес (плотность), г/м²';
COMMENT ON COLUMN public.kp_fabrics.price_category IS
  'Ценовая категория завода как написано: E, 1–5 у Amigo, 0–5 у Интерстиля';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kp_fabrics_factory_article
  ON public.kp_fabrics (factory_id, article) WHERE article IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kp_fabrics_collection
  ON public.kp_fabrics (factory_id, collection);

-- 5. Какая ткань подходит к какой системе ------------------------------------

CREATE TABLE IF NOT EXISTS public.kp_system_fabrics (
  system_id uuid NOT NULL REFERENCES public.kp_systems (id) ON DELETE CASCADE,
  fabric_id uuid NOT NULL REFERENCES public.kp_fabrics (id) ON DELETE CASCADE,
  PRIMARY KEY (system_id, fabric_id)
);

COMMENT ON TABLE public.kp_system_fabrics IS
  'Совместимость: какие ткани завод разрешает для системы (у Amigo — вкладка «Рулонные ткани» системы)';

CREATE INDEX IF NOT EXISTS idx_kp_system_fabrics_fabric
  ON public.kp_system_fabrics (fabric_id);

-- 6. Фото, схемы, образцы, PDF -----------------------------------------------

CREATE TABLE IF NOT EXISTS public.kp_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id      uuid REFERENCES public.kp_systems (id) ON DELETE CASCADE,
  fabric_id      uuid REFERENCES public.kp_fabrics (id) ON DELETE CASCADE,
  kind           text NOT NULL,
  title          text,
  storage_path   text,
  source_url     text,
  bytes          bigint,
  sort           integer NOT NULL DEFAULT 0,
  show_to_client boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kp_files_kind_check CHECK (kind IN ('photo', 'scheme', 'swatch', 'pdf')),
  CONSTRAINT kp_files_owner_check CHECK (num_nonnulls(system_id, fabric_id) = 1),
  CONSTRAINT kp_files_place_check CHECK (storage_path IS NOT NULL OR source_url IS NOT NULL)
);

COMMENT ON TABLE public.kp_files IS
  'Файлы каталога: фото, схемы, образцы тканей, PDF. Принадлежат системе или ткани (ровно одно из двух)';
COMMENT ON COLUMN public.kp_files.storage_path IS
  'Путь в бакете kp-catalog. Пусто, пока файл не скачан (тогда заполнен source_url)';
COMMENT ON COLUMN public.kp_files.source_url IS
  'Откуда файл взят на сайте завода';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kp_files_storage_path
  ON public.kp_files (storage_path) WHERE storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kp_files_system
  ON public.kp_files (system_id, sort) WHERE system_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kp_files_fabric
  ON public.kp_files (fabric_id, sort) WHERE fabric_id IS NOT NULL;

-- 7. Метка «изменено» у заводов, систем и тканей (функцию завела миграция mango_calls) --

DROP TRIGGER IF EXISTS trg_kp_factories_updated_at ON public.kp_factories;
CREATE TRIGGER trg_kp_factories_updated_at
  BEFORE UPDATE ON public.kp_factories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_kp_systems_updated_at ON public.kp_systems;
CREATE TRIGGER trg_kp_systems_updated_at
  BEFORE UPDATE ON public.kp_systems
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_kp_fabrics_updated_at ON public.kp_fabrics;
CREATE TRIGGER trg_kp_fabrics_updated_at
  BEFORE UPDATE ON public.kp_fabrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Доступ: authenticated — всё, anon — ничего -------------------------------

ALTER TABLE public.kp_factories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kp_systems        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kp_system_specs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kp_fabrics        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kp_system_fabrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kp_files          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kp_factories, public.kp_systems, public.kp_system_specs,
  public.kp_fabrics, public.kp_system_fabrics, public.kp_files FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kp_factories, public.kp_systems,
  public.kp_system_specs, public.kp_fabrics, public.kp_system_fabrics, public.kp_files
  TO authenticated;

CREATE POLICY "Менеджеры CRM: заводы каталога КП" ON public.kp_factories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Менеджеры CRM: системы каталога КП" ON public.kp_systems
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Менеджеры CRM: характеристики систем каталога КП" ON public.kp_system_specs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Менеджеры CRM: ткани каталога КП" ON public.kp_fabrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Менеджеры CRM: совместимость тканей и систем каталога КП" ON public.kp_system_fabrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Менеджеры CRM: файлы каталога КП" ON public.kp_files
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 9. Закрытый бакет для файлов каталога --------------------------------------

INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
VALUES (
  'kp-catalog', 'kp-catalog', false,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Каталог КП: менеджеры читают файлы" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'kp-catalog');

CREATE POLICY "Каталог КП: менеджеры добавляют файлы" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'kp-catalog');

CREATE POLICY "Каталог КП: менеджеры меняют файлы" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'kp-catalog') WITH CHECK (bucket_id = 'kp-catalog');

CREATE POLICY "Каталог КП: менеджеры удаляют файлы" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'kp-catalog');

COMMIT;
