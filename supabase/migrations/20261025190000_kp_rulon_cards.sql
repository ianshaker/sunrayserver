-- ============================================================================
-- Каталог КП: рулонные системы Amigo до идеала, вторая часть (25.10.2026) — карточки, главные фото, схемы и иконки семи систем
-- (ROOF, UNI1, ROLLA, UNI2, BNT, AMG, MG) и добавка к карточке MINI. Цвета фурнитуры с фото — отдельная миграция 20261025160000.
--
-- Зачем: у MINI в базе были карточка (7 строк + строка описания), главное фото и своя схема; у остальных семи — ничего, лист КП печатал им
-- только текст. Тексты карточек — те же 7 строк «параметр — значение», что у MINI, собраны из описания и вкладок страниц завода (23.10.2026),
-- цвета фурнитуры — по вкладке «Цвета фурнитуры» (с фото), а не по абзацу описания: они расходятся (MINI 5 против 4, UNI 9 против 6, AMG 4 против 3).
-- Иконка системы (kp_systems.icon_svg) — упрощённая схема: те же детали без рамки окна, линия втрое толще; показывается на плитке системы в
-- «Добавить позицию». Схемы рисуем сами в стиле SUNRAY (серая опора, чёрное изделие, зелёное управление), перерисовка — позже.
--
-- Что делает:
--   1. kp_systems.icon_svg — разметка SVG иконки (до 2 КБ); пусто — на плитке системы иконки нет;
--   2. kp_systems.card_text — 8 строк описания (MINI без изменений);
--   3. kp_system_specs — 54 строк карточки (вкладка и группа «Карточка», kind = 'card', по 7 на систему, у MG — 5); MINI: строка «Цвета фурнитуры» получает «чёрный»;
--   4. kp_files — 7 главных фото (photo) и 7 схем (scheme) в закрытом бакете kp-catalog (amigo/<система>/main.webp и scheme.svg, загружены
--      командой из upload.sh ДО этой миграции);
--   5. иконки 8 систем.
--
-- Что НЕ делает: ничего не удаляет; MINI — фото и схему не трогает; Горизонтальные 50 и все остальные системы — не трогает.
--
-- Применять точечно (db push нельзя): supabase db query --linked --workdir sunrayserver-main -f supabase/migrations/20261025190000_kp_rulon_cards.sql
-- Идемпотентна: повторный запуск возвращает строки на место. Код CRM переживает отсутствие icon_svg (иконки грузятся отдельным запросом).
--
-- ВНИМАНИЕ: парсер Amigo (parser/amigo/vyhod/zapis_amigo.sql) перед записью делает DELETE всех kp_system_specs завода Amigo — его повторный
-- запуск сотрёт и строки card; после такого запуска эту миграцию и 20261024120000 нужно прогнать ещё раз.
--
-- Откат: DELETE FROM public.kp_system_specs WHERE kind = 'card' AND system_id IN (SELECT id FROM public.kp_systems WHERE code IN ('ROOF', 'UNI1', 'ROLLA', 'UNI2', 'BNT', 'AMG', 'MG'));
--        UPDATE public.kp_systems SET card_text = NULL WHERE code IN ('ROOF', 'UNI1', 'ROLLA', 'UNI2', 'BNT', 'AMG', 'MG');
--        DELETE FROM public.kp_files WHERE storage_path IN ('amigo/roof/main.webp', 'amigo/uni1/main.webp', 'amigo/rolla/main.webp', 'amigo/uni2/main.webp', 'amigo/bnt/main.webp', 'amigo/amg/main.webp', 'amigo/mg/main.webp', 'amigo/roof/scheme.svg', 'amigo/uni1/scheme.svg', 'amigo/rolla/scheme.svg', 'amigo/uni2/scheme.svg', 'amigo/bnt/scheme.svg', 'amigo/amg/scheme.svg', 'amigo/mg/scheme.svg');
--        ALTER TABLE public.kp_systems DROP COLUMN icon_svg;
--        строку «Цвета фурнитуры» MINI вернуть: 'Белый, коричневый, дуб, тёмно-серый'.
-- ============================================================================

BEGIN;

-- 1. Иконка системы -------------------------------------------------------------

ALTER TABLE public.kp_systems
  ADD COLUMN IF NOT EXISTS icon_svg text;

COMMENT ON COLUMN public.kp_systems.icon_svg IS
  'Разметка SVG упрощённой иконки системы для плитки в «Добавить позицию» (до 2 КБ, без скриптов). Пусто — иконки нет';

-- 2. Строки карточки: «параметр — значение», sort 1..7 ---------------------------

INSERT INTO public.kp_system_specs (system_id, tab, group_name, kind, label, value, sort, show_to_client)
SELECT s.id, 'Карточка', 'Карточка', 'card', v.label, v.value, v.sort, true
  FROM (VALUES
    ('MINI', 'Окна', 'Вертикальные и поворотно-откидные, угол наклона 0–15°', 1),
    ('MINI', 'Крепление на раму', 'Сверление, на скотч, на накидные кронштейны', 2),
    ('MINI', 'Исполнение', 'Свободновисящая, внизу магнитная фиксация или боковая на леску', 3),
    ('MINI', 'Управление', 'Цепь через блок барабанного типа, слева или справа', 4),
    ('MINI', 'Намотка', 'Прямая (рулон виден) или обратная (рулон невидим), фиксация на любом уровне', 5),
    ('MINI', 'Труба', 'Алюминиевая, диаметр 19 мм', 6),
    ('MINI', 'Цвета фурнитуры', 'Белый, коричневый, дуб, тёмно-серый, чёрный', 7),
    ('ROOF', 'Окна', 'Мансардные Velux, Fakro и Roto; любой угол наклона, вплоть до горизонтального', 1),
    ('ROOF', 'Затемнение', '100 %; с тканями BLACK-OUT засветов по периметру изделия нет', 2),
    ('ROOF', 'Фиксация полотна', 'Gravity Free: пружина натягивает ткань, шнуры в направляющих фиксируют полотно в выбранном положении', 3),
    ('ROOF', 'Управление', 'Ручное или электропривод на АКБ; опция — удлинитель ручки 1 м, 1,5 м, 2 м', 4),
    ('ROOF', 'Труба', 'Алюминиевая, как и все профили', 5),
    ('ROOF', 'Комплект поставки', 'Изделие, верхний кронштейн DF11 (2 шт.), инструкция по установке, гарантийный талон', 6),
    ('ROOF', 'Модель ДЕНЬ-НОЧЬ', 'Два полотна с разным светопропусканием: закрыто одной тканью, обеими или полностью открыто', 7),
    ('UNI1', 'Окна', 'Вертикальные и поворотно-откидные ПВХ, угол наклона 0–15°', 1),
    ('UNI1', 'Штапик', 'Прямоугольный, глубиной не менее 14 мм', 2),
    ('UNI1', 'Крепление на раму', 'Сверление, на скотч', 3),
    ('UNI1', 'Исполнение', 'Короб с плоскими направляющими; ткань разматывается в пространстве штапика, между стеклом и направляющей', 4),
    ('UNI1', 'Управление', 'Цепь через механизм барабанного типа, слева или справа', 5),
    ('UNI1', 'Фиксация полотна', 'На любом заданном уровне', 6),
    ('UNI1', 'Цвета фурнитуры', 'Белый, серебро, золотой дуб, белый дуб, золотой дуб (сублимация), чёрный, махагон, серый, коричневый', 7),
    ('ROLLA', 'Окна', 'Вертикальные и поворотно-откидные ПВХ, угол наклона 0–15°', 1),
    ('ROLLA', 'Крепление на раму', 'Сверление или на скотч', 2),
    ('ROLLA', 'Исполнение', 'Короб со скошенными торцами (увеличивает угол открытия рамы) и боковые направляющие на раме окна', 3),
    ('ROLLA', 'Управление', 'Механизм Rolla 19; совместима с электроприводом со встроенной аккумуляторной батареей', 4),
    ('ROLLA', 'Затемнение', 'Боковые направляющие дают наибольшее затемнение помещения', 5),
    ('ROLLA', 'Проветривание', 'При откидывании створки ткань не отклоняется от стекла и не раскачивается', 6),
    ('ROLLA', 'Подоконник', 'Не занимает пространство подоконника, его можно использовать для различных целей', 7),
    ('UNI2', 'Окна', 'Вертикальные и поворотно-откидные ПВХ, угол наклона 0–15°; с пружиной — также мансардные и потолочные', 1),
    ('UNI2', 'Крепление на раму', 'Сверление, на скотч (при управлении цепью)', 2),
    ('UNI2', 'Исполнение', 'Короб с С-образными направляющими; установка коробом вверх или вниз', 3),
    ('UNI2', 'Управление', 'Цепь, слева или справа; либо ручка по центру нижней планки с пружинным механизмом', 4),
    ('UNI2', 'Фиксация полотна', 'На любом заданном уровне', 5),
    ('UNI2', 'Дополнительно', 'Второй короб (вторая ткань) — модель «День-ночь»: два изделия на одной паре направляющих', 6),
    ('UNI2', 'Цвета фурнитуры', 'Белый, серебро, золотой дуб, белый дуб, золотой дуб (сублимация), чёрный, махагон, серый, коричневый; с пружиной — только белый', 7),
    ('BNT', 'Установка', 'В проём (на потолок) или на проём (на стену)', 1),
    ('BNT', 'Серии', 'M — малые и средние проёмы; M+ — средние, только кассета; L — большие проёмы', 2),
    ('BNT', 'Модели', 'Классические открытые (в том числе с тканями ЗЕБРА), кассеты, МОНО, день-ночь M с двумя полотнами', 3),
    ('BNT', 'Труба', 'Алюминиевая; M — 29, 43, 44 мм, M+ — 43, 44, 52 мм, L — 43, 52, 65, 75 мм', 4),
    ('BNT', 'Управление', 'Цепь пластиковая или металлическая, слева или справа, длина 3/4 высоты или любая; электропривод', 5),
    ('BNT', 'Намотка', 'Открытые модели: видимый рулон (прямая) или невидимый (обратная); с тканью Зебра рулон всегда виден', 6),
    ('BNT', 'Цвета фурнитуры', 'Серия M — хром, шампань, матовый хром; серия L — белый; классика M и L — серый, чёрный, белый', 7),
    ('AMG', 'Установка', 'В проём или на проём окна', 1),
    ('AMG', 'Модели', 'Классические открытые, кассетные, пружинные; дополнительные — ДЕНЬ-НОЧЬ, DOUBLE и MONO', 2),
    ('AMG', 'Управление', 'Цепочный механизм; пружинный — с демпфером и автостопом, фиксация на любом уровне (шаг 1–2 см); электропривод AMIGO', 3),
    ('AMG', 'Труба', '32 и 45 мм — ручное управление, 35 и 45 мм — моторизованные изделия', 4),
    ('AMG', 'Кассета', 'Короб защищает рулон от пыли и повреждений; боковые направляющие с тканью Black-Out дают максимальное затемнение', 5),
    ('AMG', 'Несколько полотен', 'ДЕНЬ-НОЧЬ — два на одной паре кронштейнов; DOUBLE — два с отдельным управлением; MONO — два или три с единым управлением', 6),
    ('AMG', 'Цвета фурнитуры', 'Антрацит, серый, белый, чёрный; нижняя рейка — белая, серая мат., антрацит мат., чёрная мат.', 7),
    ('MG', 'Установка', 'В проём и на проём', 1),
    ('MG', 'Труба', '25 мм', 2),
    ('MG', 'Механизм', 'MG II на пластиковых кронштейнах (по умолчанию) или стальных; с монтажным профилем и коробом — MGS', 3),
    ('MG', 'Цвета фурнитуры', 'Белый, коричневый; с монтажным профилем и коробом — только белый', 4),
    ('MG', 'Боковая фиксация', 'Не предусмотрена', 5)
  ) AS v(code, label, value, sort),
  public.kp_factories f,
  public.kp_systems s
 WHERE lower(f.name) = 'amigo'
   AND s.factory_id = f.id
   AND s.code = v.code
ON CONFLICT (system_id, group_name, label) DO UPDATE
  SET tab            = EXCLUDED.tab,
      kind           = EXCLUDED.kind,
      value          = EXCLUDED.value,
      sort           = EXCLUDED.sort,
      show_to_client = EXCLUDED.show_to_client;

-- 3. Строка описания для карточки ---------------------------------------------------

UPDATE public.kp_systems s
   SET card_text = v.card_text
  FROM (VALUES
    ('MINI', 'Компактная модель рулонных штор для установки на раму окна.'),
    ('ROOF', 'Специализированная система рулонных штор для мансардных окон Velux, Fakro и Roto.'),
    ('UNI1', 'Практичная модель рулонных штор в коробе с направляющими для установки на раму окна.'),
    ('ROLLA', 'Современная модель рулонных штор в коробе с направляющими для ткани, разработанная в России.'),
    ('UNI2', 'Модель рулонных штор в коробе с С-образными направляющими для окон ПВХ с любой глубиной штапика.'),
    ('BNT', 'Система рулонных штор BNT серий M, M+, L для установки в проём или на проём.'),
    ('AMG', 'Универсальная система рулонных штор для световых проёмов любого размера, есть модели для панорамного остекления.'),
    ('MG', 'Рулонные шторы Классика MG (Besta, Польша) для установки в проём и на проём.')
  ) AS v(code, card_text)
  JOIN public.kp_factories f ON lower(f.name) = 'amigo'
 WHERE s.factory_id = f.id
   AND s.code = v.code;

-- 4. Файлы карточек: главные фото и схемы (сами файлы уже в бакете) -----------------------

INSERT INTO public.kp_files (system_id, kind, title, storage_path, source_url, bytes, sort, show_to_client)
SELECT s.id, v.kind, v.title, v.storage_path, v.source_url, v.bytes, v.sort, true
  FROM (VALUES
    ('ROOF', 'photo', 'ROOF — главное фото', 'amigo/roof/main.webp',
     'https://amigo.ru/upload/iblock/ad9/ad9fedf0c475de882d5f9ad7d1d31375.jpg', 22048, 0),
    ('UNI1', 'photo', 'UNI1 — главное фото', 'amigo/uni1/main.webp',
     'https://amigo.ru/upload/iblock/187/18780f4073b7f6f1b7c7f5f38b0dc259.jpg', 23016, 0),
    ('ROLLA', 'photo', 'ROLLA — главное фото', 'amigo/rolla/main.webp',
     'https://amigo.ru/upload/iblock/3cc/xfolvp25mg8fwbospw99weowzch3k2qw.jpg', 13320, 0),
    ('UNI2', 'photo', 'UNI2 — главное фото', 'amigo/uni2/main.webp',
     'https://amigo.ru/upload/iblock/f66/pzptx176oat2qian24y0u3xh2t41ajp6.jpg', 15222, 0),
    ('BNT', 'photo', 'BNT — главное фото', 'amigo/bnt/main.webp',
     'https://amigo.ru/upload/iblock/8ce/8ceb4b65b4d8524f8e2278b75a5cfeea.jpg', 40514, 0),
    ('AMG', 'photo', 'AMG — главное фото', 'amigo/amg/main.webp',
     'https://amigo.ru/upload/iblock/8cc/jx6k6j1loy3fojdksp6az8calkx0yzm6.png', 27666, 0),
    ('MG', 'photo', 'MG — главное фото', 'amigo/mg/main.webp',
     'https://amigo.ru/upload/iblock/250/250968ec737e257a869592ce724093f0.jpg', 31806, 0),
    ('ROOF', 'scheme', 'ROOF — схема системы (наша)', 'amigo/roof/scheme.svg', NULL, 932, 0),
    ('UNI1', 'scheme', 'UNI1 — схема системы (наша)', 'amigo/uni1/scheme.svg', NULL, 969, 0),
    ('ROLLA', 'scheme', 'ROLLA — схема системы (наша)', 'amigo/rolla/scheme.svg', NULL, 996, 0),
    ('UNI2', 'scheme', 'UNI2 — схема системы (наша)', 'amigo/uni2/scheme.svg', NULL, 933, 0),
    ('BNT', 'scheme', 'BNT — схема системы (наша)', 'amigo/bnt/scheme.svg', NULL, 845, 0),
    ('AMG', 'scheme', 'AMG — схема системы (наша)', 'amigo/amg/scheme.svg', NULL, 908, 0),
    ('MG', 'scheme', 'MG — схема системы (наша)', 'amigo/mg/scheme.svg', NULL, 876, 0)
  ) AS v(code, kind, title, storage_path, source_url, bytes, sort),
  public.kp_factories f,
  public.kp_systems s
 WHERE lower(f.name) = 'amigo'
   AND s.factory_id = f.id
   AND s.code = v.code
ON CONFLICT (storage_path) WHERE storage_path IS NOT NULL DO UPDATE
  SET system_id = EXCLUDED.system_id, kind = EXCLUDED.kind, title = EXCLUDED.title,
      source_url = EXCLUDED.source_url, bytes = EXCLUDED.bytes, sort = EXCLUDED.sort;

-- 5. Иконки систем ------------------------------------------------------------------

UPDATE public.kp_systems s
   SET icon_svg = v.icon_svg
  FROM (VALUES
    ('MINI', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора MINI на раме окна: цепь управления, труба, полотно, нижняя планка">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="34" y="34" width="8" height="18" rx="1.5"/><rect x="158" y="34" width="8" height="18" rx="1.5"/><rect x="42" y="38" width="116" height="10" rx="5"/><circle cx="53" cy="43" r="8.5"/><path d="M62 48V184M156 48V184"/><rect x="60" y="184" width="98" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M48.5 50.4V146a4.5 4.5 0 0 0 9 0V50.4"/></g>
</svg>$svg$),
    ('ROOF', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора ROOF на мансардном окне: боковые алюминиевые направляющие, труба, полотно, нижняя планка, ручка">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="34" y="34" width="6" height="190" rx="2"/><rect x="160" y="34" width="6" height="190" rx="2"/><rect x="42" y="36" width="116" height="10" rx="5"/><path d="M48 46V166M152 46V166"/><rect x="46" y="166" width="108" height="10" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M100 176V198"/><circle cx="100" cy="205" r="6"/></g>
</svg>$svg$),
    ('UNI1', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора UNI в коробе на раме окна: короб, плоские направляющие, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="44" y="34" width="112" height="20" rx="3"/><rect x="44" y="54" width="6" height="152" rx="2"/><rect x="150" y="54" width="6" height="152" rx="2"/><path d="M56 54V176M144 54V176"/><rect x="54" y="176" width="92" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M32.5 40V150a4.5 4.5 0 0 0 9 0V40"/></g>
</svg>$svg$),
    ('ROLLA', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора Rolla Кассета на раме окна: короб со скошенными торцами, боковые направляющие, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><path d="M44 54L48 34H152L156 54Z"/><rect x="44" y="54" width="8" height="152" rx="2"/><rect x="148" y="54" width="8" height="152" rx="2"/><path d="M58 54V176M142 54V176"/><rect x="56" y="176" width="88" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M158.5 40V150a4.5 4.5 0 0 0 9 0V40"/></g>
</svg>$svg$),
    ('UNI2', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора UNI 2 в коробе на раме окна: короб, С-образные направляющие, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="44" y="34" width="112" height="20" rx="3"/><path d="M54 56H46V204H54"/><path d="M146 56H154V204H146"/><path d="M50 56V176M150 56V176"/><rect x="48" y="176" width="104" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M32.5 40V150a4.5 4.5 0 0 0 9 0V40"/></g>
</svg>$svg$),
    ('BNT', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора BNT в проёме: кронштейны, труба, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="30" y="30" width="10" height="26" rx="2"/><rect x="160" y="30" width="10" height="26" rx="2"/><rect x="40" y="34" width="120" height="14" rx="7"/><path d="M58 48V190M142 48V190"/><rect x="56" y="190" width="88" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M147.5 50V150a4.5 4.5 0 0 0 9 0V50"/></g>
</svg>$svg$),
    ('AMG', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора AMG в проёме: кронштейны, труба с механизмом цепи, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="30" y="30" width="10" height="26" rx="2"/><rect x="160" y="30" width="10" height="26" rx="2"/><rect x="40" y="36" width="120" height="12" rx="6"/><circle cx="54" cy="42" r="9"/><path d="M68 48V184M140 48V184"/><rect x="66" y="184" width="82" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M34.5 50V146a4.5 4.5 0 0 0 9 0V50"/></g>
</svg>$svg$),
    ('MG', $svg$<svg xmlns="http://www.w3.org/2000/svg" viewBox="25 28 150 200" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Рулонная штора MG в проёме: небольшие кронштейны, тонкая труба, полотно, нижняя планка, цепь управления">
  <g id="izdelie" stroke="#111111" stroke-width="4.6"><rect x="32" y="34" width="8" height="14" rx="1.5"/><rect x="160" y="34" width="8" height="14" rx="1.5"/><rect x="40" y="38" width="120" height="8" rx="4"/><path d="M60 46V176M144 46V176"/><rect x="58" y="176" width="92" height="8" rx="4"/></g>
  <g id="upravlenie" stroke="#48C48F" stroke-width="5.2"><path d="M42.5 48V140a4.5 4.5 0 0 0 9 0V48"/></g>
</svg>$svg$)
  ) AS v(code, icon_svg)
  JOIN public.kp_factories f ON lower(f.name) = 'amigo'
 WHERE s.factory_id = f.id
   AND s.code = v.code;

-- 6. Проверка: при несовпадении — RAISE EXCEPTION и откат всей транзакции -------------------

DO $$
DECLARE
  n_card integer;
  n_text integer;
  n_photo integer;
  n_scheme integer;
  n_icon integer;
  n_mini integer;
BEGIN
  SELECT count(*) INTO n_card
    FROM public.kp_system_specs p
    JOIN public.kp_systems s ON s.id = p.system_id
    JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo' AND s.code IN ('MINI', 'ROOF', 'UNI1', 'ROLLA', 'UNI2', 'BNT', 'AMG', 'MG')
     AND p.kind = 'card' AND p.tab = 'Карточка' AND p.group_name = 'Карточка' AND p.show_to_client AND p.sort BETWEEN 1 AND 7;
  SELECT count(*) INTO n_text
    FROM public.kp_systems s JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo' AND s.code IN ('MINI', 'ROOF', 'UNI1', 'ROLLA', 'UNI2', 'BNT', 'AMG', 'MG') AND s.card_text IS NOT NULL AND s.card_text <> '';
  SELECT count(*) INTO n_photo FROM public.kp_files WHERE kind = 'photo' AND storage_path IN ('amigo/roof/main.webp', 'amigo/uni1/main.webp', 'amigo/rolla/main.webp', 'amigo/uni2/main.webp', 'amigo/bnt/main.webp', 'amigo/amg/main.webp', 'amigo/mg/main.webp');
  SELECT count(*) INTO n_scheme FROM public.kp_files WHERE kind = 'scheme' AND storage_path IN ('amigo/roof/scheme.svg', 'amigo/uni1/scheme.svg', 'amigo/rolla/scheme.svg', 'amigo/uni2/scheme.svg', 'amigo/bnt/scheme.svg', 'amigo/amg/scheme.svg', 'amigo/mg/scheme.svg');
  SELECT count(*) INTO n_icon
    FROM public.kp_systems s JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo' AND s.code IN ('MINI', 'ROOF', 'UNI1', 'ROLLA', 'UNI2', 'BNT', 'AMG', 'MG') AND s.icon_svg LIKE '<svg %' AND length(s.icon_svg) < 2000;
  SELECT count(*) INTO n_mini
    FROM public.kp_system_specs p
    JOIN public.kp_systems s ON s.id = p.system_id
    JOIN public.kp_factories f ON f.id = s.factory_id
   WHERE lower(f.name) = 'amigo' AND s.code = 'MINI' AND p.kind = 'card' AND p.label = 'Цвета фурнитуры' AND p.value LIKE '%чёрный%';
  IF n_card <> 54 THEN RAISE EXCEPTION 'kp_rulon_cards: строк карточки % вместо 54', n_card; END IF;
  IF n_text <> 8 THEN RAISE EXCEPTION 'kp_rulon_cards: систем с card_text % вместо 8', n_text; END IF;
  IF n_photo <> 7 THEN RAISE EXCEPTION 'kp_rulon_cards: записей о фото % вместо 7', n_photo; END IF;
  IF n_scheme <> 7 THEN RAISE EXCEPTION 'kp_rulon_cards: записей о схемах % вместо 7', n_scheme; END IF;
  IF n_icon <> 8 THEN RAISE EXCEPTION 'kp_rulon_cards: иконок % вместо 8', n_icon; END IF;
  IF n_mini <> 1 THEN RAISE EXCEPTION 'kp_rulon_cards: у MINI нет чёрного в «Цветах фурнитуры»'; END IF;
END $$;

COMMIT;
