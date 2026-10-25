-- ============================================================================
-- Цвета фурнитуры рулонных систем Amigo: таблица kp_system_colors и 41 строк (40 с фото).
--
-- Зачем: на сайте завода у каждого цвета фурнитуры есть название и фотография, а у нас были только названия строкой
-- в характеристиках, и «Цветовая гамма» в редакторе показывала 4 цвета без чёрного. Слово Яна 25.10.2026: перенести
-- фото и цвета в базу, начиная с рулонных (пять из восьми систем имеют вкладку «Цвета фурнитуры»: MINI, UNI, UNI2,
-- BNT, AMG; у ROOF, Rolla, MG её нет). Сборка — PLANS/CRM/22-kp-polnocennye/_syroe/skripty/kp-colors-build.py.
--
-- Фото — по одному файлу WebP на уникальную картинку в закрытом бакете kp-catalog (amigo/colors/<md5-12>.webp, загружены
-- командой supabase storage cp); UNI и UNI2 делят файлы, поэтому путь в таблице не уникален. У BNT «Нижняя рейка
-- BENTHIN белая М» на сайте общая картинка с шестью рейками — фото у неё не берём (storage_path пуст).
-- «Часть» (part): 'Фурнитура' или 'Нижняя рейка' — в редакторе это два отдельных выбора.
--
-- Старые строки kp_system_specs с цветами не трогаются. Идемпотентна: повторный запуск обновляет строки.
-- Откат: DROP TABLE public.kp_system_colors; файлы бакета amigo/colors/ удалить через Storage API.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.kp_system_colors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id      uuid NOT NULL REFERENCES public.kp_systems (id) ON DELETE CASCADE,
  part           text NOT NULL DEFAULT 'Фурнитура',
  name           text NOT NULL,
  storage_path   text,
  source_url     text,
  bytes          bigint,
  sort           integer NOT NULL DEFAULT 0,
  show_to_client boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kp_system_colors_key UNIQUE (system_id, part, name)
);

COMMENT ON TABLE public.kp_system_colors IS
  'Цвета фурнитуры системы с фото завода: строка = один цвет одной части (фурнитура, нижняя рейка); в редакторе КП — выбор с фото';
COMMENT ON COLUMN public.kp_system_colors.part IS
  'Какая часть изделия: Фурнитура или Нижняя рейка; каждая часть выбирается в редакторе отдельно';
COMMENT ON COLUMN public.kp_system_colors.storage_path IS
  'Фото цвета в закрытом бакете kp-catalog; пусто — фото нет, показывается только название. Путь у разных систем может совпадать (UNI и UNI2)';

CREATE INDEX IF NOT EXISTS idx_kp_system_colors_system
  ON public.kp_system_colors (system_id, sort);

ALTER TABLE public.kp_system_colors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kp_system_colors FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kp_system_colors TO authenticated;

DROP POLICY IF EXISTS "Менеджеры CRM: цвета систем каталога КП" ON public.kp_system_colors;
CREATE POLICY "Менеджеры CRM: цвета систем каталога КП" ON public.kp_system_colors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.kp_system_colors (system_id, part, name, storage_path, source_url, bytes, sort)
SELECT s.id, v.part, v.name, v.storage_path, v.source_url, v.bytes, v.sort
  FROM (VALUES
    ('MINI', 'Фурнитура', 'Белый MINI', 'amigo/colors/52018f7806a0.webp', 'https://amigo.ru/upload/iblock/06a/06abf115dab29cd83a0e5cfde739ecb0.jpg', 6206, 0),
    ('MINI', 'Фурнитура', 'Коричневый MINI', 'amigo/colors/c034cc07e36a.webp', 'https://amigo.ru/upload/iblock/c4a/c4af5c16270d4be75f331844b77a5a3e.jpg', 8314, 1),
    ('MINI', 'Фурнитура', 'Темно-серый MINI', 'amigo/colors/d12b453ac63c.webp', 'https://amigo.ru/upload/iblock/e18/e18399c5e8e9267a20b72504877ad39d.jpg', 8402, 2),
    ('MINI', 'Фурнитура', 'Дуб MINI', 'amigo/colors/c313f8ec529c.webp', 'https://amigo.ru/upload/iblock/3ae/3ae686f7f17cec5f9d1b52ba87602852.jpg', 5812, 3),
    ('MINI', 'Фурнитура', 'Черный MINI', 'amigo/colors/10270a478528.webp', 'https://amigo.ru/upload/iblock/240/sxmbifyoy252jz2y0yjv10qqutaw5vpu.jpg', 4714, 4),
    ('UNI1', 'Фурнитура', 'Белый UNI', 'amigo/colors/2174303e9ae2.webp', 'https://amigo.ru/upload/iblock/0a4/0a46648a480c50d522d1a6fb8ebce9f4.jpg', 1582, 0),
    ('UNI1', 'Фурнитура', 'Серебро UNI', 'amigo/colors/80914d134f39.webp', 'https://amigo.ru/upload/iblock/679/679230b7148d45d07ab3235be02b873c.jpg', 1890, 1),
    ('UNI1', 'Фурнитура', 'Золотой дуб UNI', 'amigo/colors/ae8c4064d15f.webp', 'https://amigo.ru/upload/iblock/310/31008066eb58abe9d61b950667c3a63e.jpg', 3564, 2),
    ('UNI1', 'Фурнитура', 'Белый дуб UNI', 'amigo/colors/d7f55ef97a1b.webp', 'https://amigo.ru/upload/iblock/66a/66a2cc7630ffe999f65738fdb160727d.jpg', 5336, 3),
    ('UNI1', 'Фурнитура', 'Золотой дуб UNI (сублимация)', 'amigo/colors/9df0f23f9222.webp', 'https://amigo.ru/upload/iblock/aa7/aa791875f68e60f8007f617e37d72b34.jpg', 4778, 4),
    ('UNI1', 'Фурнитура', 'Черный UNI', 'amigo/colors/8b01d53bfb78.webp', 'https://amigo.ru/upload/iblock/be5/8acsj92ghovye306p0a1jbb6sfymoub5.jpg', 2802, 5),
    ('UNI1', 'Фурнитура', 'Махагон UNI', 'amigo/colors/961425729c53.webp', 'https://amigo.ru/upload/iblock/0f2/0f23b01d62e162a9b511be48220e7810.jpg', 3264, 6),
    ('UNI1', 'Фурнитура', 'Серый UNI', 'amigo/colors/7922d98cb295.webp', 'https://amigo.ru/upload/iblock/b23/b23f9999f2429727ebe10ac37392c0ad.jpg', 2898, 7),
    ('UNI1', 'Фурнитура', 'Коричневый UNI', 'amigo/colors/5b7a840c97a6.webp', 'https://amigo.ru/upload/iblock/64f/64f625ab5917e6e13f280b9bb0403dfa.jpg', 2790, 8),
    ('UNI2', 'Фурнитура', 'Белый UNI', 'amigo/colors/2174303e9ae2.webp', 'https://amigo.ru/upload/iblock/0a4/0a46648a480c50d522d1a6fb8ebce9f4.jpg', 1582, 0),
    ('UNI2', 'Фурнитура', 'Серебро UNI', 'amigo/colors/80914d134f39.webp', 'https://amigo.ru/upload/iblock/679/679230b7148d45d07ab3235be02b873c.jpg', 1890, 1),
    ('UNI2', 'Фурнитура', 'Золотой дуб UNI', 'amigo/colors/ae8c4064d15f.webp', 'https://amigo.ru/upload/iblock/310/31008066eb58abe9d61b950667c3a63e.jpg', 3564, 2),
    ('UNI2', 'Фурнитура', 'Белый дуб UNI', 'amigo/colors/d7f55ef97a1b.webp', 'https://amigo.ru/upload/iblock/66a/66a2cc7630ffe999f65738fdb160727d.jpg', 5336, 3),
    ('UNI2', 'Фурнитура', 'Золотой дуб UNI (сублимация)', 'amigo/colors/9df0f23f9222.webp', 'https://amigo.ru/upload/iblock/aa7/aa791875f68e60f8007f617e37d72b34.jpg', 4778, 4),
    ('UNI2', 'Фурнитура', 'Черный UNI', 'amigo/colors/8b01d53bfb78.webp', 'https://amigo.ru/upload/iblock/be5/8acsj92ghovye306p0a1jbb6sfymoub5.jpg', 2802, 5),
    ('UNI2', 'Фурнитура', 'Махагон UNI', 'amigo/colors/961425729c53.webp', 'https://amigo.ru/upload/iblock/0f2/0f23b01d62e162a9b511be48220e7810.jpg', 3264, 6),
    ('UNI2', 'Фурнитура', 'Серый UNI', 'amigo/colors/7922d98cb295.webp', 'https://amigo.ru/upload/iblock/b23/b23f9999f2429727ebe10ac37392c0ad.jpg', 2898, 7),
    ('UNI2', 'Фурнитура', 'Коричневый UNI', 'amigo/colors/5b7a840c97a6.webp', 'https://amigo.ru/upload/iblock/64f/64f625ab5917e6e13f280b9bb0403dfa.jpg', 2790, 8),
    ('BNT', 'Фурнитура', 'Серия М: Хром', 'amigo/colors/9f54d6d9d519.webp', 'https://amigo.ru/upload/iblock/1f5/1f50e2fc6e30f91df79a8bde59363728.jpg', 16440, 0),
    ('BNT', 'Фурнитура', 'Серия М: Шампань', 'amigo/colors/21afd18fd374.webp', 'https://amigo.ru/upload/iblock/32d/32d633af1926053eaa42b82dcbe56610.jpg', 5132, 1),
    ('BNT', 'Фурнитура', 'Серия М: Матовый хром', 'amigo/colors/93204acf92a1.webp', 'https://amigo.ru/upload/iblock/404/404ff81d3d0c3a6edae2f3340ebacf08.jpg', 11020, 2),
    ('BNT', 'Фурнитура', 'Серия L: Белый', 'amigo/colors/50c8a6c11dd8.webp', 'https://amigo.ru/upload/iblock/69a/69ac02e30e185d65db51795eb860f34a.jpg', 9026, 3),
    ('BNT', 'Нижняя рейка', 'Нижняя рейка BENTHIN белая М', NULL, NULL, NULL, 4),
    ('BNT', 'Нижняя рейка', 'Нижняя рейка BENTHIN серый металлик М', 'amigo/colors/09248990e91d.webp', 'https://amigo.ru/upload/iblock/67b/67bbd7c71a53ab797990cde6671167a3.jpg', 1860, 5),
    ('BNT', 'Нижняя рейка', 'Нижняя рейка BENTHIN черная М', 'amigo/colors/d7c4fb998d3c.webp', 'https://amigo.ru/upload/iblock/625/ygazzg7sewnjfpl25i7txhjdov18savz.jpg', 5894, 6),
    ('BNT', 'Фурнитура', 'Классика М и L, серый', 'amigo/colors/2ccb97e0b6f5.webp', 'https://amigo.ru/upload/iblock/985/985536a2ee0338429bdb72e0d38fecb4.jpg', 1942, 7),
    ('BNT', 'Фурнитура', 'Классика М и L, черный', 'amigo/colors/cf54ce9bf9a5.webp', 'https://amigo.ru/upload/iblock/109/109bf802a492fb370ec16f695acdcc5e.jpg', 2434, 8),
    ('BNT', 'Фурнитура', 'Классика М и L, белый', 'amigo/colors/281c9e68f3c0.webp', 'https://amigo.ru/upload/iblock/d5f/d5f7ca1f665b9c51186b28c33a95af1c.jpg', 1294, 9),
    ('AMG', 'Фурнитура', 'Антрацит AMG', 'amigo/colors/e64df246ee83.webp', 'https://amigo.ru/upload/iblock/7e8/7e8bea9fcc7a69802c69a03684f45166.jpg', 17658, 0),
    ('AMG', 'Фурнитура', 'Серый AMG', 'amigo/colors/ab9300d9341f.webp', 'https://amigo.ru/upload/iblock/190/190073bc1994dc141cab4c7f4addcfbc.jpg', 11320, 1),
    ('AMG', 'Фурнитура', 'Белый AMG', 'amigo/colors/8ef5e4ba1ec4.webp', 'https://amigo.ru/upload/iblock/ae0/ae0ab7bde483634659c37101ed948fc0.jpg', 3482, 2),
    ('AMG', 'Нижняя рейка', 'Нижняя рейка AMG белая', 'amigo/colors/b3f6162d2467.webp', 'https://amigo.ru/upload/iblock/32e/tnrr5zg5nsup8vt06twvl57efp2z511c.png', 2098, 3),
    ('AMG', 'Нижняя рейка', 'Нижняя рейка AMG серая мат.', 'amigo/colors/50f0005b3dc6.webp', 'https://amigo.ru/upload/iblock/c13/hvzqupqngw1h90kgwrvek7gdwvbkp7nj.jpg', 2690, 4),
    ('AMG', 'Нижняя рейка', 'Нижняя рейка AMG антрацит мат.', 'amigo/colors/63130c5c3916.webp', 'https://amigo.ru/upload/iblock/5a9/xllfdz2w44blwpuqcsdo7oh4bud23ymr.jpg', 3838, 5),
    ('AMG', 'Фурнитура', 'Черный AMG', 'amigo/colors/a8e0d9f19b6d.webp', 'https://amigo.ru/upload/iblock/65e/4qsa2s1nwievdi6uxym917r83i6h13vi.png', 8868, 6),
    ('AMG', 'Нижняя рейка', 'Нижняя рейка AMG черная мат.', 'amigo/colors/e54d2321fa87.webp', 'https://amigo.ru/upload/iblock/002/osnc0mu5ksrai6ips2fmyocs9r9ogt1n.jpg', 3388, 7)
  ) AS v(code, part, name, storage_path, source_url, bytes, sort),
  public.kp_factories f,
  public.kp_systems s
 WHERE lower(f.name) = 'amigo'
   AND s.factory_id = f.id
   AND s.code = v.code
ON CONFLICT (system_id, part, name) DO UPDATE
  SET storage_path = EXCLUDED.storage_path, source_url = EXCLUDED.source_url, bytes = EXCLUDED.bytes, sort = EXCLUDED.sort;

DO $$
DECLARE n integer; p integer;
BEGIN
  SELECT count(*), count(storage_path) INTO n, p FROM public.kp_system_colors;
  IF n <> 41 OR p <> 40 THEN
    RAISE EXCEPTION 'kp_system_colors: строк % (ждали 41), с фото % (ждали 40)', n, p;
  END IF;
END $$;

COMMIT;
