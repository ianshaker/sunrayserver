/**
 * Шаблон сметы для PDF (PLANS/SERVER/05-pdf-smet). Буква А (17.10.2026) — перенос Deno-функции Supabase `generate-estimate-pdf`
 * на наш сервер: расчёты, дозаполнение позиций и имя файла (index.ts), разбор чисел. Буква З (19.10.2026) — новый вид, принят
 * Яном: лист A5, позиции карточками вместо таблицы.
 *
 * Подключён в server.js: маршрут POST /api/pdf/smeta регистрирует pdf-smet/route.js, он берёт отсюда buildHtml и имя файла.
 * Старая Deno-функция в CRM (generate-estimate-pdf, лист A4) до буквы Е живёт со старым видом: правишь расчёты — правь и там.
 *
 * Вид: лист A5. Сверху плитка-«восход» (заголовок документа, № и дата, логотип), дальше клиент, карточки позиций, «Расчёт стоимости»
 * и плашки акции и НДС 5 %; внизу срок КП обычным текстом и плитка-«закат» («Итого к оплате» и реквизиты компании).
 * Шрифт Montserrat — Google Fonts. Логотип — PNG с прозрачностью data:-адресом (logo-data.js: SVG-логотип на растре PDF теряет градиенты).
 * Фото-обложки и печати компании нет: headerImageUrl шаблон не читает (тело запроса может его прислать, как и прежде, — на смету не влияет).
 *
 * Лист и печать:
 *   - A5: `@page { size: 420pt 595pt }` — A5 в точках, как страница PDF у Chrome (при «148mm 210mm» страница PDF шире области
 *     содержимого на 0,47 pt, и плитка не дошла бы до края). pechat.js печатает с preferCSSPageSize: true и без format:
 *     размер листа, поля и подвал берутся отсюда.
 *   - Поля через @page: сверху 12 мм (на первом листе 0 — плитка у самого верха), снизу 16 мм, по бокам 0. Боковые 10 мм даёт отступ
 *     .sheet: Chrome не рисует содержимое в полях @page, поэтому плитки стоят вне .sheet. В нижнем поле — margin-боксы @page:
 *     слева «SUNRAY · КП №…» (только если есть номер обращения), справа «Лист k из M» (counter(page), counter(pages); нужен Chrome ≥ 131:
 *     на Render — @sparticuz/chromium 153).
 *   - Последний лист — именованная страница `final` (@page final): нижнего поля и подвала нет — «Лист k из M», «SUNRAY · КП №…» и линия
 *     над ними там не печатаются, нижняя плитка стоит вплотную к низу листа.
 *   - Внешних адресов страница не просит, кроме Google Fonts: pechat.js пускает data:, шрифты Google и публичный Storage Supabase.
 *
 * Правила листов («никогда в жизни какая-то позиция не налегала сверху или снизу», Ян 19.10.2026):
 *   1. Каждый блок тела — обычный div класса .blk с break-inside: avoid: плитка клиента, карточка позиции, плашки акции и НДС 5 %,
 *      «Расчёт стоимости». Позиция между листами не режется.
 *   2. Верхняя плитка (.bleed) и плитка клиента держатся со следующим блоком (break-after: avoid): на листе не остаются одни в конце.
 *   3. Последняя карточка, «Расчёт стоимости», плашки, срок КП и нижняя плитка — одна неразрывная связка <div class="tail"> на странице
 *      `final` (при одной позиции карточка остаётся с шапкой). Связка высотой в поле содержимого последнего листа на первом листе
 *      не помещается и начинается не раньше второго.
 *   4. Визуал — три сменных модуля с точной сигнатурой: CSS_PLASHKA + plashkaHtml (верхняя плитка), CSS_CARD + cardHtml (карточка позиции),
 *      CSS_TILE + tileHtml (срок КП и нижняя плитка). Ширину колонки (148 − 2×10 = 128 мм = 484 px) даёт .sheet.
 *
 * Защита: весь пользовательский текст идёт через escapeHtml; числа — только через privestiChisla (его зовёт route.js); значение в
 * CSS-строке подвала («SUNRAY · КП №…», номер обращения из тела запроса) проходит cssString: кавычки, обратная косая, < > & и
 * управляющие знаки превращаются в CSS-коды, поэтому ни строка, ни <style> не закрываются изнутри.
 *
 * Буква Б «Цена без сюрпризов» + Акция (20.10.2026, PLANS/CRM/20-smety-vid-stekla/tz-uluchsheniya-smety.md §1–3): позиция может быть с ценой за штуку
 * (`priceMode: 'unit'`, база = price × quantity — itemBase, зеркало estimateUtils.ts в CRM), акция — с условием «от N изделий» (`promoFromQty`, 2–20).
 * Акцию сервер не считает: CRM присылает готовые discountPercent / discountedPrice / НДС, здесь они печатаются как есть. Тела без новых полей печатаются
 * побайтно как раньше (golden-тест shablon.golden.test.js): новая разметка и новый CSS появляются только под новыми полями.
 *
 * Буква В «Помещения и размеры» (20.10.2026, тот же ТЗ §1–3): позиция может нести `room` (помещение, 1–60 знаков после trim) и `widthMm` × `heightMm` (целые мм 1–20000, оба или ни одного).
 * Если помещение есть хотя бы у одной позиции, карточки идут секциями: порядок секций — первое появление помещения (ключ: без регистра, «ё» = «е», пробелы в один; показ — как введено первым),
 * позиции без помещения — последней секцией «Без помещения»; над карточками секции стоит заголовок «Кухня — 24 500 ₽» / «Кухня — от 21 500 до 29 500 ₽» (итог помещения — ТЗ §2.3, зеркало roomTotals
 * в estimateUtils.ts). Заголовок держится с первой карточкой секции в одном неразрывном блоке (.blk-rhead). Размеры — мелкой строкой под материалом. Нет `room` ни у одной позиции — разметка прежняя (golden).
 */

const { mskDate } = require('../lib/mskTime');
const { LOGO_WHITE } = require('./logo-data'); // настоящий логотип с сайта: PNG с прозрачностью, data:-адрес (белая надпись — для тёмной плитки)

// Ширина листа в CSS-пикселях (420 pt = 560 px)
const BLEED_WIDTH_PX = 560;
// Верхняя (.pl) и нижняя (.tb) плитки уже листа на PLATE_SIDE_MM с каждой стороны — белые «ушки», видно, как скругление доходит до самого низа / верха.
// Скруглены только углы, не касающиеся края листа (у верхней плитки — нижние, у нижней — верхние), к краю листа (верх / низ) плитки вплотную. Тексты плиток стоят там же,
// где поле листа (10 мм от края листа), поэтому внутренний отступ плитки = 10 мм − PLATE_SIDE_MM. Менять боковой отступ — только этой цифрой.
const PLATE_SIDE_MM = 5; // боковой отступ плитки от края листа, мм
const PLATE_PAD_MM = Math.max(0, 10 - PLATE_SIDE_MM); // внутренний отступ плитки до текста / логотипа, мм
const PLATE_W_CSS = `calc(100% - ${2 * PLATE_SIDE_MM}mm)`; // ширина плитки: лист минус два отступа
// Арт плиток (artSunrise, artSunset) рисуется 1:1 на реальную ширину плитки: лист 560 px минус два боковых отступа (5 мм = 18,9 px) = 522,2 px; viewBox равен размеру плитки, подгонки нет
const PLATE_W_PX = +(BLEED_WIDTH_PX - 2 * PLATE_SIDE_MM * 96 / 25.4).toFixed(2);
// Высота связки .tail = поле содержимого ПОСЛЕДНЕГО листа (страница `final`: A5 595 pt = 793,33 px; поле сверху 12 мм = 45,35 px, снизу 0 → 747,98 px; у остальных листов
// было бы 687,5 px: нижнее поле 16 мм отдаёт подвалу) с запасом на округление, чтобы связка не уходила на следующий лист; плитка внутри связки прижата к низу этой высоты:
// текст срока КП (.tb-note) имеет margin-top: auto, плитка стоит сразу за ним
const TAIL_MIN_PX = 747; // 747,98 минус ≈ 1 px на округление Chrome (на Chrome 155 хватало и 747,9, но другой Chrome может округлить страницу иначе); у самого низа вылет арта на 3 px (.tb-bg, H+3) закрывает белую полоску, но по растру 400 % ≈ 0,24 pt (0,09 мм) белого всё же остаётся

// ── styles.ts ────────────────────────────────────────────────────────────────

/**
 * Строка для CSS «content: "…"» внутри <style>: номер обращения приходит из тела запроса, поэтому экранируем всё, что может
 * закрыть строку или сам <style> (кавычки, обратная косая, < > &, управляющие знаки) — в виде «\3c » (код символа и пробел).
 */
function cssString(value) {
  return String(value).replace(/[\u0000-\u001f\u007f"'\\<>&]/g, (ch) => `\\${ch.codePointAt(0).toString(16)} `);
}

// Поля @page: сверху 12 мм (на первом листе 0), снизу 16 мм, по бокам 0 — боковые 10 мм даёт .sheet (см. шапку файла: Chrome не
// рисует в полях @page, поэтому плитка во весь лист стоит вне .sheet, а не вылетает в поля).
// Подвал — margin-боксы: каждый 50 % ширины минус 10 мм отступа от края листа; линия сверху (border-top) стоит в 5 мм под полем
// содержимого, текст — под линией. @page :first меняет только верхнее поле, боксы подвала остаются на первом листе.
function pageCss(footerLeft, pc = false, wideFooter = false) {
  const footer = `
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: 12px; font-weight: 600; line-height: 1;
    color: #57534e;
    vertical-align: top;
    margin-top: 5mm;
    padding-top: 2.4mm;
    border-top: 1px solid #e6dfcd;
    width: calc(50% - 10mm);
  `;
  return `
  @page {
    size: ${pc ? '595pt 842pt' : '420pt 595pt'};
    margin: 12mm 0 16mm 0;
    @bottom-left {
      content: "${footerLeft ? cssString(footerLeft) : ''}";
      margin-left: 10mm;
      text-align: left;
      ${footer}${wideFooter ? `
      width: calc(76% - 10mm);` : ''}
    }
    @bottom-right {
      content: "Лист " counter(page) " из " counter(pages);
      margin-right: 10mm;
      text-align: right;
      ${footer}${wideFooter ? `
      width: calc(24% - 10mm);` : ''}
      font-weight: 700;
      color: #145c45;
    }
  }
  @page :first { margin-top: 0; }
  /* последний лист — связка .tail (page: final): нижнего поля нет (плитка идёт до самого низа листа) и подвала нет (ни «SUNRAY · КП №…», ни «Лист k из M», ни линии над ними).
     Связка высотой в поле содержимого листа на листе 1 (там плитка) не помещается и всегда начинается с листа 2 */
  @page final {
    margin-bottom: 0;
    @bottom-left { content: none; margin: 0; padding: 0; border: 0; }
    @bottom-right { content: none; margin: 0; padding: 0; border: 0; }
  }${pc ? `
  /* вся смета на одном листе (формат «ПК»): ни полей, ни подвала — шапка у верха, плитка у низа */
  @page one {
    margin: 0;
    @bottom-left { content: none; margin: 0; padding: 0; border: 0; }
    @bottom-right { content: none; margin: 0; padding: 0; border: 0; }
  }` : ''}`;
}

// Условие акции «от N изделий» в плашке — жирным цветом акцента листа (оранжевый #a34a0b, как у строки скидки в расчёте; на #ffe8cf контраст ≈ 5:1). Правило дописывается в конец CSS
// только телам с promoFromQty: у старых смет HTML побайтно прежний (golden), поэтому в общий CSS оно не входит
const CSS_PROMO_COND = `
  .promo-banner .promo-cond { font-weight: 700; color: #a34a0b; white-space: nowrap; }`;

// Строка «N × цена ₽» над ценником позиции «за штуку» (priceMode 'unit') — самая тихая строка ценника: 13 px / 500, цвет как у «Цена …» (.cd-pre). Правило дописывается в конец CSS только телам,
// где такая позиция есть: у остальных HTML побайтно прежний (golden)
const CSS_UNIT = `
  .cd-unit { font-size: 13px; font-weight: 500; line-height: 1.25; color: #57534e; }`;

// Размеры позиции «ширина × высота, мм» (буква В) — мелкая строка под материалом: 12,5 px / 500, цвет как у материала (.cd-mat), в одну строку. Правило дописывается в конец CSS только телам,
// где размеры есть хотя бы у одной позиции: у остальных HTML побайтно прежний (golden)
const CSS_SIZE = `
  .cd-size { margin-top: 2px; font-size: 12.5px; font-weight: 500; line-height: 1.3; color: #625d56; white-space: nowrap; }`;

// Секции помещений (буква В): заголовок «Кухня — 24 500 ₽» над карточками помещения — мягкая мятная полоса в тон плашки «НДС 5 %» (градиент 120°, контур 1 px, непрозрачные заливки, без золота) с «диском»
// 8 px, как у номера карточки; легче карточки: одна строка 14 px, вес не выше 700. Высота строки заголовка — ROOM_LINE_H, одной строки вместе с воздухом под ним — ROOM_HEAD_H (3 + 18 + 3 поля, 2 контур,
// 6 воздух = 32 px): по этим числам считается связка .tail (estNeed). Правило дописывается в конец CSS только телам, где у какой-то позиции есть помещение
const ROOM_LINE_H = 18; // строка заголовка помещения, px
const ROOM_HEAD_H = 32; // заголовок помещения из одной строки вместе с воздухом под ним, px
const CSS_ROOMS = `
  .rm { display: flex; align-items: flex-start; gap: 8px; padding: 3px 14px; margin-bottom: 6px; background: linear-gradient(120deg, #f5faf7 0%, #e6f1ea 100%); border: 1px solid #d6e9de; border-radius: 14px; font-size: 14px; line-height: ${ROOM_LINE_H}px; color: #0f3a2c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rm::before { content: ''; flex: none; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: radial-gradient(circle at 32% 26%, #1c6b50 0%, #0f3a2c 100%); }
  .rm-t { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .rm-name { font-weight: 700; }
  .rm-dash { font-weight: 500; color: #625d56; }
  .rm-sum { font-weight: 700; color: #145c45; white-space: nowrap; }
  /* заголовок и первая карточка секции — один неразрывный блок (.blk): заголовок не остаётся один внизу листа; между секциями воздуха больше, чем между карточками */
  .blk-card + .blk-rhead { margin-top: 8px; }`;

function getStyles({ footerLeft = '', promoCond = false, unitRow = false, sizeRow = false, roomRows = false, compact = false, pc = false, city = false } = {}) {
  return `${pageCss(footerLeft, pc, city && Boolean(footerLeft))}
  :root {
    --fs-m: 15.5px;
    --r-block: 22px;
    --hair: #ece6d8;
    --paper: radial-gradient(ellipse 110% 170% at 100% 0%, #fbf0da 0%, #fdf8ee 36%, #ffffff 78%);
    --disc: radial-gradient(circle at 32% 26%, #1c6b50 0%, #145c45 50%, #0f3a2c 100%);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: var(--fs-m);
    line-height: 1.35;
    color: #1c1917;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Правила листов ──
     .bleed — контейнер верхней плитки: вне .sheet, ширина 100 % = весь лист (560 px), без боковых полей; плитка внутри уже его на PLATE_SIDE_MM с каждой стороны; на первом листе
              поле сверху 0 (@page :first), поэтому плитка прилегает к верху листа. Содержимое плитки рисует модуль plashkaHtml.
     .sheet — остальное тело: боковые поля 10 мм (у @page боковых полей нет).
     .blk — любой блок тела: неразрывный, воздух под ним — margin (на границе листа Chrome его отбрасывает).
     .keep-next — блок держится со следующим (плитка клиента не остаётся одна в конце листа).
     .tail — последняя карточка + «Расчёт стоимости» + плашки + текст срока КП + НИЖНЯЯ ПЛИТКА одной связкой: flex-колонка высотой в поле содержимого последнего листа
             (страница final без нижнего поля и без подвала), текст срока (.tb-note, margin-top: auto) и плитка (.tb) за ним стоят у самого низа листа; связка неразрывна и
             начинается с верха листа. */
  .bleed { width: 100%; margin: 0 0 12px; break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .sheet { padding: 0 10mm; }
  .blk { break-inside: avoid; page-break-inside: avoid; margin: 0 0 8px; }
  .blk.gap-m { margin-bottom: 12px; }
  .blk.keep-next { break-after: avoid; page-break-after: avoid; }
  .tail { page: final; display: flex; flex-direction: column; min-height: ${TAIL_MIN_PX}px; break-inside: avoid; page-break-inside: avoid; }
  /* если связка всё же выше листа (оценка в buildHtml ошиблась), рвётся только между карточкой и расчётом: расчёт, плашки и плитка склеены */
  .tail > .sheet { break-after: avoid; page-break-after: avoid; }
  .tail .blk-totals { break-after: avoid; page-break-after: avoid; }
  .tail .blk-promo, .tail .blk-vat5 { break-before: avoid; page-break-before: avoid; break-after: avoid; page-break-after: avoid; }

  /* ── Карточка клиента ── */
  /* «бумага» (--paper: тёплый свет из правого верхнего угла), контур 1 px --hair, радиус --r-block (22); аватар — «диск» (--disc) с белой буквой; чип «Обращение #…» — тёплая пилюля
     без контура, не сжимается, но не шире половины карточки: длинный номер обращения (CRM кладёт туда и заметку) сокращается многоточием. Подписи ТЕЛЕФОН/ГОРОД/АДРЕС — изумрудным #145c45 (на кремовом #fbf0da ≈ 6,9:1). Вес не выше 700. */
  .client { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px 11px; background: var(--paper); border: 1px solid var(--hair); border-radius: var(--r-block); }
  .cl-ava { flex: none; width: 36px; height: 36px; margin-top: 1px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--disc); font-size: 16px; font-weight: 700; line-height: 1; color: #ffffff; }
  .cl-body { flex: 1 1 auto; min-width: 0; }
  .cl-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .cl-name { min-width: 0; font-size: 17px; font-weight: 700; color: #0f3a2c; line-height: 1.25; overflow-wrap: anywhere; }
  .cl-id { flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: -1px; padding: 3px 10px 4px; background: #efe8d6; border-radius: 999px; font-size: 12.5px; font-weight: 700; line-height: 1.2; color: #0f3a2c; }
  .cl-det { display: flex; flex-wrap: wrap; gap: 2px 20px; margin-top: 4px; font-size: var(--fs-m); color: #1c1917; overflow-wrap: anywhere; }
  .cl-det i { font-style: normal; font-size: 12px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #145c45; margin-right: 6px; white-space: nowrap; }

  /* ── Плашки: акция и НДС 5% ── */
  /* радиус --r-block (22), контур 1 px тоном плашки, градиент 120° с непрозрачными остановками; значок — белый на цветном «диске» (оранжевый / изумрудный), как аватар клиента.
     Контраст текста: #7a3608 на #ffe8cf ≈ 7,5:1, #0f3a2c на #dff0e7 ≈ 11:1 */
  .promo-banner, .vat-included-banner { display: flex; align-items: center; gap: 12px; padding: 8px 16px 8px 10px; border: 1px solid; border-radius: var(--r-block); font-size: 15px; font-weight: 600; line-height: 1.35; }
  .promo-banner { background: linear-gradient(120deg, #fff7ec 0%, #ffe8cf 100%); border-color: #f6dcc0; color: #7a3608; }
  .vat-included-banner { background: linear-gradient(120deg, #f5faf7 0%, #dff0e7 100%); border-color: #d6e9de; color: #0f3a2c; }
  .bn-ico { flex: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 32% 26%, #ee9a52 0%, #cf6a22 56%, #a94e14 100%); }
  .vat-included-banner .bn-ico { background: var(--disc); }
  .bn-ico svg { display: block; width: 17px; height: 17px; }
  .bn-txt { flex: 1 1 auto; min-width: 0; }

  /* ── Расчёт стоимости ── */
  /* блок — та же «бумага» (вертикальный тёплый градиент, контур 1 px --hair, радиус 22); шапка — градиент изумруд → слива (как верх плиток) с сдержанным отблеском справа (TH_ART, 6 колец) и жалюзи;
     заголовок обычным регистром 15 / 600; строки с воздухом (4 px) и тонким разделителем 1 px #eee8d9; чип «включён в стоимость» — мягкий мятный градиент без контура. Строки скидки, НДС и монтажа — ниже. */
  .totals-right { background: linear-gradient(180deg, #ffffff 0%, #faf6ec 100%); border: 1px solid var(--hair); border-radius: var(--r-block); overflow: hidden; }
  .totals-header { position: relative; display: flex; align-items: center; padding: 9px 16px; background: linear-gradient(98deg, #0e3a30 0%, #0e3a30 22%, #2b1b3e 92%); }
  .th-art { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
  .totals-header-text { position: relative; font-size: 15px; font-weight: 600; line-height: 1.2; color: #f3ede2; }
  .totals-body { padding: 3px 16px 8px; }
  .totals-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 4px 0; font-size: 15px; line-height: 1.3; color: #625d56; border-bottom: 1px solid #eee8d9; }
  .totals-row:last-child { border-bottom: 0; }
  .totals-row .t-label { font-weight: 400; }
  .totals-row .t-value { font-weight: 700; color: #0f3a2c; text-align: right; }
  .t-chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 11px 2px 8px; background: linear-gradient(135deg, #f1f8f4 0%, #dcefe5 100%); border-radius: 999px; font-size: 13.5px; font-weight: 600; line-height: 1.3; color: #145c45; white-space: nowrap; }
  .t-chip svg { display: block; width: 13px; height: 13px; flex: none; }
  .totals-row.discount-row .t-label, .totals-row.discount-row .t-value { color: #a34a0b; }
  .totals-row.vat-row .t-label, .totals-row.vat-row .t-value,
  .totals-row.montage-row .t-label, .totals-row.montage-row .t-value { color: #145c45; }
  /* строки «Итого к оплате» в расчёте нет: итог стоит в нижней плитке (.tb-strip), см. CSS_TILE */

  /* ── Сменные модули визуала ── */
  ${CSS_PLASHKA}
  ${CSS_CARD}
  ${CSS_TILE}${promoCond ? CSS_PROMO_COND : ''}${unitRow ? CSS_UNIT : ''}${sizeRow ? CSS_SIZE : ''}${roomRows ? CSS_ROOMS : ''}${compact ? CSS_COMPACT : ''}${pc ? CSS_PC : ''}${city ? CSS_CITY : ''}
`;
}

// ── template.ts ──────────────────────────────────────────────────────────────
// Хвостовой «/» отрезаем: на Render адрес могут записать с ним, и в путях файлов хранилища вышло бы «//» (дыра 11).
// «||», а не «??»: пустая переменная тоже даёт запасной адрес (как lib/supabaseClient.js).
// В самой смете картинок из хранилища нет; адрес нужен pechat.js: белый список адресов страницы пускает публичный Storage этого проекта.
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xyzkneqhggpxstxqbqhs.supabase.co').replace(/\/+$/, '');

// Значки плашек (процент, чек) и галочка чипа — inline-SVG, обводка со скруглёнными концами, печатаются вектором
const svgIco = (color, inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
const ICO_PERCENT = svgIco('#ffffff', '<path d="M18.5 5.5l-13 13"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>');
const ICO_RECEIPT = svgIco('#ffffff', '<path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9.5 8.5h5M9.5 12h5"/>');
const ICO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#145c45" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// Отблеск в шапке «Расчёта стоимости» — 6 колец, каждое разбито на 8 (48 кругов с постоянной прозрачностью α/8, как AR_HALO у арта плиток, только мельче: на растре 400 % у 6 колец были видны ступеньки); viewBox 482 × 36 = реальный размер шапки, preserveAspectRatio none; два ряда жалюзи
const TH_GLOW = [[84, .03], [70, .035], [57, .04], [45, .045], [34, .05], [24, .055]]
  .flatMap(([r, a], i, all) => { const up = i ? all[i - 1][0] : r + 14; return Array.from({ length: 8 }, (_, j) => [r + (up - r) * (7 - j) / 8, a / 8]); })
  .map(([r, a]) => `<circle cx="440" cy="42" r="${r.toFixed(1)}" fill-opacity="${a.toFixed(4)}"/>`).join('');
const TH_ART = `<svg class="th-art" viewBox="0 0 482 36" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g fill="#ffd9a8">${TH_GLOW}</g><g fill="none" stroke="#ffe8d8" stroke-width="1" stroke-linecap="round"><path stroke-opacity=".26" d="M300 8h46M316 16h40M334 24h34M350 31h28"/><path stroke-opacity=".15" d="M354 8h22M364 16h18M376 24h14M386 31h10"/></g></svg>`;

/**
 * База позиции (ТЗ 20.10.2026 §1): `priceMode: 'unit'` — цена за штуку, база = price × quantity; иначе ('total' и тела без поля) — цена за всю
 * позицию, база = price. Скидка, НДС и итог позиции считаются от базы. Зеркало itemBase в CRM (estimateUtils.ts): правишь тут — правь там.
 */
function itemBase(item) {
  return item.priceMode === 'unit' ? item.price * item.quantity : item.price;
}

// ── Помещения и размеры (буква В) ────────────────────────────────────────────
const NAZVANIE_MAX = 60; // знаков в названии помещения после trim
const BEZ_POMESHCHENIYA = 'Без помещения'; // подпись последней секции: позиции, у которых помещения нет

/**
 * Название помещения для показа: пробелы по краям убраны, повторные пробелы — в один, не длиннее NAZVANIE_MAX знаков (по символам, а не по кодовым единицам). Не строка и пусто — '' («помещения нет»).
 * Идемпотентна: route.js (privestiChisla) зовёт её на входе, buildHtml — ещё раз при группировке, чтобы тело, собранное мимо маршрута, вело себя так же.
 */
function nazvanieKomnaty(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, NAZVANIE_MAX).join('').trim();
}

/** Ключ секции: «кухня», «Кухня», «КУХНЯ» — одно помещение, «ё» = «е». */
function klyuchKomnaty(nazvanie) {
  return nazvanie.toLowerCase().replace(/ё/g, 'е');
}

/** «1 200 × 1 400 мм» (ширина × высота; неразрывные пробелы) или '' — размеров нет или они не целые 1–20000 (маршрут такие тела не пропускает). */
function razmeryTekst(item, num) {
  const { widthMm: w, heightMm: h } = item;
  const verno = (v) => Number.isInteger(v) && v >= 1 && v <= 20000;
  return verno(w) && verno(h) ? `${num(w)} × ${num(h)} мм` : '';
}

/**
 * Итог помещения (ТЗ §2.3; зеркало roomTotals в estimateUtils.ts): сумма итогов позиций помещения после скидки и НДС (finalPriceWithVat, как пришли; монтаж не входит). Позиции группы вариантов
 * (groupId есть в groups — иначе карточка тоже печатается без группы) считаются одним вариантом: минимум = обычные + минимум каждой группы, максимум = обычные + максимум каждой группы.
 * В группе считаются только позиции ЭТОГО помещения. min === max — итог одним числом.
 */
function itogPomeshcheniya(items, groups) {
  const idGrupp = new Set(groups.map((g) => g.id));
  let obychnye = 0;
  const poGruppam = new Map();
  for (const item of items) {
    const cena = item.finalPriceWithVat ?? item.discountedPrice;
    if (!item.groupId || !idGrupp.has(item.groupId)) { obychnye += cena; continue; }
    const g = poGruppam.get(item.groupId);
    if (g) { g.min = Math.min(g.min, cena); g.max = Math.max(g.max, cena); } else poGruppam.set(item.groupId, { min: cena, max: cena });
  }
  let min = obychnye, max = obychnye;
  for (const g of poGruppam.values()) { min += g.min; max += g.max; }
  return { min, max };
}

/**
 * Секции помещений в порядке ПЕРВОГО появления помещения в items; внутри секции позиции идут в порядке тела. Позиции без помещения — последней секцией «Без помещения».
 * null — помещения нет ни у одной позиции (или все позиции «без помещения»): смета печатается без секций, разметка прежняя.
 * @returns {{ label: string, items: any[], min: number, max: number }[] | null}
 */
function sektsiiPomeshcheniy(items, groups) {
  const nazvaniya = items.map((item) => nazvanieKomnaty(item.room));
  if (!nazvaniya.some(Boolean)) return null;
  const sektsii = [];
  const poKlyuchu = new Map();
  const klyuchBez = klyuchKomnaty(BEZ_POMESHCHENIYA);
  let bez = null;
  items.forEach((item, i) => {
    const klyuch = nazvaniya[i] ? klyuchKomnaty(nazvaniya[i]) : '';
    if (!klyuch || klyuch === klyuchBez) { // «без помещения», напечатанное руками, — то же, что пусто
      bez = bez || { label: BEZ_POMESHCHENIYA, items: [] };
      bez.items.push(item);
      return;
    }
    let s = poKlyuchu.get(klyuch);
    if (!s) { s = { label: nazvaniya[i], items: [] }; poKlyuchu.set(klyuch, s); sektsii.push(s); }
    s.items.push(item);
  });
  if (!sektsii.length) return null;
  if (bez) sektsii.push(bez);
  return sektsii.map((s) => ({ ...s, ...itogPomeshcheniya(s.items, groups) }));
}

function buildHtml(data) {
  // headerImageUrl шаблон не читает: плитка рисуется кодом, фото-обложки нет (решение Яна 19.10.2026)
  const {
    clientData, items, promoDiscount = null, promoFromQty = null, vatIncluded5 = false,
    groups = [], montage = null, validUntil = null, createdDay = null, printDay = null, sheet = 'big', cityContext = null,
  } = data;
  // Город объекта (необязательный): нет или пустое имя — лист печатается как раньше, побайтно; есть — подзаголовок шапки, метка над итогом, подвал и адрес сайта города в реквизитах
  const { name: cityName, host: siteHost } = gorodObekta(cityContext);
  const pc = sheet === 'pc'; // формат «ПК»: лист A4 (595 × 842 pt), та же компактная вёрстка, обычная смета — на одном листе
  const compact = sheet === 'compact' || pc; // «компактный» лист: та же фирменная вёрстка, но блоки собраны плотнее (CP_*, CSS_COMPACT); большой лист печатается как раньше

  // Дни приходят готовыми строками «2026-09-29»: их считает CRM по Москве. Свои часы
  // у службы печати живут по UTC и ночью поставили бы в файл вчерашнее число.
  //
  // Зеркало правил CRM — Deno-функция не видит исходников, поэтому копия. Правишь там — правь здесь:
  // днём ↔ formatDay, разницаДней ↔ daysBetween, запасной деньПечатиIso ↔ moscowDay — src/lib/moscowDate.ts
  // (в CRM день считает date-fns-tz, здесь mskDate из lib/mskTime — у сервера своя московская дата, одна на все модули);
  // словоДней ↔ склонить — src/utils/formatters.ts (в CRM его зовёт daysWord);
  // дни от дня составления ↔ daysFromValidUntil, прежний текст про 14 дней ↔ LEGACY_PDF_VALIDITY_DAYS —
  // src/components/department/calculations/estimate/validity.ts
  // Всё, что днём() возвращает, идёт прямо в HTML, поэтому экранируем здесь (дыра 5): для настоящих дат
  // «2026-09-29» результат тот же, а подставное тело запроса не вставит в страницу разметку
  const днём = (day) => escapeHtml(day.split('-').reverse().join('.'));
  // Запасной путь для старых вкладок CRM, которые не шлют день: считаем его по Москве сами (denPechati).
  // деньПечатиIso — «ГГГГ-ММ-ДД», деньПечатиНаЛисте — он же для показа в смете, «ДД.ММ.ГГГГ»
  const деньПечатиIso = denPechati(printDay);
  const деньПечатиНаЛисте = днём(деньПечатиIso);
  const разницаДней = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
  const словоДней = (n) => {
    const десятки = Math.abs(n) % 100;
    const последняя = Math.abs(n) % 10;
    if (десятки >= 11 && десятки <= 14) return 'дней';
    if (последняя === 1) return 'день';
    if (последняя >= 2 && последняя <= 4) return 'дня';
    return 'дней';
  };

  // У сметы со сроком дата окончания стоит крупно, а день составления — подписью:
  // две одинаковые даты рядом читаются как одна и путают клиента.
  // Дни считаются от дня составления, который напечатан строкой ниже: блок обязан сходиться
  // сам с собой. 16.09.2026 было иначе — дни от дня печати, и клиент читал «14 дней до 30.09,
  // составлена 16.08», а 16.08 + 14 = 30.08. Меньше одного дня бывает только у даты, попавшей
  // в базу мимо CRM, — тогда число не пишем вовсе
  const деньСоставления = createdDay || деньПечатиIso;
  const срокДней = validUntil ? разницаДней(validUntil, деньСоставления) : 0;
  const сколькоДействует = срокДней >= 1 ? `${срокДней} ${словоДней(срокДней)}` : '';
  // Срок КП — на белом поле листа сразу НАД нижней плиткой (.tb-note, не в ней): один ЛЕВЫЙ блок без правой колонки — линия 1 px →
  // метка «СРОК ПРЕДЛОЖЕНИЯ» → основная строка (13 px, дата полужирная) → мелкая строка (только в виде «до»):
  //   вид со сроком «до»: «Предложение действительно 14 дней — до 26.10.2026» и под ней мелко «Смета составлена 12.10.2026»
  //     (число дней не посчитать — меньше суток — «Предложение действительно до 26.10.2026», без числа);
  //   вид без срока: «Настоящее коммерческое предложение действительно в течение 14 дней с момента формирования. Дата: 19.10.2026» в одну-две строки, мелкой строки нет
  const validityMain = validUntil
    ? `Предложение действительно${сколькоДействует ? ` ${сколькоДействует} —` : ''} до <b>${днём(validUntil)}</b>`
    : `Настоящее коммерческое предложение действительно в течение 14 дней с момента формирования. Дата: <b>${деньПечатиНаЛисте}</b>`;
  const validitySub = validUntil ? `Смета составлена ${днём(деньСоставления)}` : '';
  const vlab = cityName
    ? `<div class="tb-vlab tb-vlab-city"><span>Срок предложения</span><span class="tb-city">${CITY_ICO}<i>Объект</i><b>${escapeHtml(cityName)}</b></span></div>`
    : '<div class="tb-vlab">Срок предложения</div>';
  const validityNote = `${vlab}<div class="tb-vmain">${validityMain}</div>${validitySub ? `<div class="tb-vsub">${validitySub}</div>` : ''}`;

  // Зеркало montage.ts из CRM: к итогу прибавляется только своя сумма и только
  // больше нуля, «включён» и «бесплатно» показываются словами и итог не двигают
  const montageAmount = montage && montage.mode === 'sum' && Number.isFinite(Number(montage.amount))
    ? Math.max(0, Math.round(Number(montage.amount)))
    : 0;
  // «включён в стоимость» и «бесплатно» — статус, а не сумма: чип с галочкой (мятный фон, изумрудный текст); сумма — числом, как раньше
  const montageLine = !montage || montage.mode === 'none'
    ? null
    : montage.mode === 'included'
      ? `<span class="t-chip">${ICO_CHECK}включён в стоимость</span>`
      : montage.mode === 'free'
        ? `<span class="t-chip">${ICO_CHECK}бесплатно</span>`
        : `${montageAmount.toLocaleString('ru-RU')} ₽`;

  // «Сумма без скидки» — сумма баз позиций (itemBase): у позиции «за штуку» это цена × количество, у остальных цена
  const totalBasePrice = items.reduce((sum, item) => sum + itemBase(item), 0);
  const totalAfterDiscount = items.reduce((sum, item) => sum + item.discountedPrice, 0);
  const totalDiscountAmount = totalBasePrice - totalAfterDiscount;
  const totalVatAmount = items.reduce((sum, item) => sum + (item.vatAmount ?? 0), 0);
  const totalFinalItems = items.reduce((sum, item) => sum + (item.finalPriceWithVat ?? item.discountedPrice), 0);

  // Вычисляем итоговый диапазон для PDF
  const baseTotal = items.filter(i => !i.groupId).reduce((s, i) => s + (i.finalPriceWithVat ?? i.discountedPrice), 0);
  const hasGroups = groups.length > 0 && items.some(i => i.groupId);
  let groupMin = 0;
  let groupMax = 0;
  if (hasGroups) {
    groups.forEach(g => {
      const gItems = items.filter(i => i.groupId === g.id);
      if (gItems.length === 0) return;
      const prices = gItems.map(i => i.finalPriceWithVat ?? i.discountedPrice);
      groupMin += Math.min(...prices);
      groupMax += Math.max(...prices);
    });
  }
  const finalMin = baseTotal + groupMin + montageAmount;
  const finalMax = baseTotal + groupMax + montageAmount;

  // Базовые суммы без групп (нужны для диапазонов)
  const basePriceNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + itemBase(i), 0);
  const baseAfterDiscountNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + i.discountedPrice, 0);
  const baseDiscNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + (itemBase(i) - i.discountedPrice), 0);
  const baseVatNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + (i.vatAmount ?? 0), 0);

  let groupPriceMin = 0, groupPriceMax = 0;
  let groupAfterDiscountMin = 0, groupAfterDiscountMax = 0;
  let groupDiscMin = 0, groupDiscMax = 0;
  let groupVatMin = 0, groupVatMax = 0;
  if (hasGroups) {
    groups.forEach(g => {
      const gItems = items.filter(i => i.groupId === g.id);
      if (gItems.length === 0) return;
      groupPriceMin         += Math.min(...gItems.map(i => itemBase(i)));
      groupPriceMax         += Math.max(...gItems.map(i => itemBase(i)));
      groupAfterDiscountMin += Math.min(...gItems.map(i => i.discountedPrice));
      groupAfterDiscountMax += Math.max(...gItems.map(i => i.discountedPrice));
      // скидка = база - discountedPrice у каждого item, не разница вариантов
      groupDiscMin          += Math.min(...gItems.map(i => itemBase(i) - i.discountedPrice));
      groupDiscMax          += Math.max(...gItems.map(i => itemBase(i) - i.discountedPrice));
      groupVatMin           += Math.min(...gItems.map(i => i.vatAmount ?? 0));
      groupVatMax           += Math.max(...gItems.map(i => i.vatAmount ?? 0));
    });
  }

  const displayPriceMin     = basePriceNoGroup + groupPriceMin;
  const displayPriceMax     = basePriceNoGroup + groupPriceMax;
  const displayAfterDiscMin = baseAfterDiscountNoGroup + groupAfterDiscountMin;
  const displayAfterDiscMax = baseAfterDiscountNoGroup + groupAfterDiscountMax;
  const displayDiscMin      = baseDiscNoGroup + groupDiscMin;
  const displayDiscMax      = baseDiscNoGroup + groupDiscMax;
  const displayVatMin       = baseVatNoGroup + groupVatMin;
  const displayVatMax       = baseVatNoGroup + groupVatMax;

  const hasAnyDiscount = items.some(i => i.discountPercent > 0);
  const hasAnyVat = hasGroups
    ? (displayVatMin > 0 || displayVatMax > 0)
    : totalVatAmount > 0;

  // Для "Количество позиций" — диапазон min/max по quantity внутри каждой группы
  const qtyFlatServer = items.filter(i => !i.groupId).reduce((s, i) => s + i.quantity, 0);
  let groupQtyMin = 0, groupQtyMax = 0;
  if (hasGroups) {
    groups.forEach(g => {
      const gItems = items.filter(i => i.groupId === g.id);
      if (gItems.length === 0) return;
      groupQtyMin += Math.min(...gItems.map(i => i.quantity));
      groupQtyMax += Math.max(...gItems.map(i => i.quantity));
    });
  }
  const displayQtyMin = qtyFlatServer + groupQtyMin;
  const displayQtyMax = qtyFlatServer + groupQtyMax;
  const displayQtyStr = hasGroups && displayQtyMin !== displayQtyMax
    ? `от ${displayQtyMin} до ${displayQtyMax}`
    : String(displayQtyMin);

  // Цвета групп для PDF (фон карточки, цвет номера-кружка и точки «Гр. N»). Не цвета CRM (синий / фиолетовый / розовый), а
  // приглушённая «ювелирная» палитра в тон листа, все заливки непрозрачные: тил, слива, янтарь, роза, шалфей
  const GROUP_COLORS_PDF = [
    { bg: '#f0faf8', label: '#0f766e' },  // тил
    { bg: '#f9f1f6', label: '#7a3b69' },  // слива
    { bg: '#fff8ea', label: '#a45f0a' },  // янтарь
    { bg: '#fdf1f3', label: '#b04458' },  // роза
    { bg: '#f4f9ec', label: '#4f7a28' },  // шалфей
  ];

  // Число и сумма: тысячи делит неразрывный пробел (toLocaleString), перед «₽» — обычный пробел; знак рубля от суммы не отрывается за счёт white-space: nowrap у ценника и итога
  const num = (n) => n.toLocaleString('ru-RU');
  const rub = (n) => `${num(n)} ₽`;

  // Карточки позиций: разметку каждой даёт модуль cardHtml, обёртку (неразрывный блок) — buildHtml.
  // Цена — за позицию целиком, на количество не умножается (кроме priceMode 'unit').
  // Помещения (буква В): есть хотя бы одно — карточки идут секциями (порядок и «Без помещения» — sektsiiPomeshcheniy), номера карточек — по порядку на листе; первая карточка секции несёт заголовок
  // помещения в том же неразрывном блоке (.blk-rhead). Помещений нет — shown это items как пришли, разметка прежняя (golden)
  const sektsii = sektsiiPomeshcheniy(items, groups);
  const shown = sektsii
    ? sektsii.flatMap((s) => s.items.map((item, k) => ({ item, sektsiya: k === 0 ? s : null })))
    : items.map((item) => ({ item, sektsiya: null }));
  const roomSum = (s) => (s.min === s.max ? rub(s.min) : `от ${num(s.min)} до ${rub(s.max)}`);
  const roomHead = (s) => `<div class="rm"><span class="rm-t"><span class="rm-name">${escapeHtml(s.label)}</span><span class="rm-dash"> — </span><span class="rm-sum">${roomSum(s)}</span></span></div>`;
  const cardBlocks = shown.map(({ item, sektsiya }, idx) => {
    const groupIdx = item.groupId ? groups.findIndex(g => g.id === item.groupId) : -1;
    const groupColor = groupIdx >= 0 ? GROUP_COLORS_PDF[groupIdx % GROUP_COLORS_PDF.length] : null;
    const groupNum = groupIdx >= 0 ? groupIdx + 1 : null;
    const html = (compact ? cardHtmlCompact : cardHtml)(item, idx, { hasAnyDiscount, hasAnyVat, groupColor, groupNum, rub, num, escapeHtml });
    return sektsiya ? `<div class="blk blk-card blk-rhead">${roomHead(sektsiya)}${html}</div>` : `<div class="blk blk-card">${html}</div>`;
  });
  // Последняя карточка уходит в связку «хвост» с расчётом (расчёт не остаётся на листе без позиции). Исключение — одна позиция:
  // шапка + карточка + расчёт бывают выше листа, и тогда шапка важнее — карточка остаётся с шапкой, расчёт может уйти на
  // следующий лист (Chrome сам режет связку, а не оставляет лист с одной шапкой)
  const lastCardBlock = cardBlocks.length > 1 ? cardBlocks.pop() : '';

  // буква в аватар-кружке — первая буква имени клиента (нет имени — «К»)
  const clientInitial = (clientData && Array.from(String(clientData.clientName || '').trim())[0] || 'К').toUpperCase();
  const clientBlock = clientData ? `
      <div class="blk blk-client gap-m keep-next">
        <div class="client">
          <span class="cl-ava" aria-hidden="true">${escapeHtml(clientInitial)}</span>
          <div class="cl-body">
            <div class="cl-top">
              <div class="cl-name">${escapeHtml(clientData.clientName || '—')}</div>
              ${clientData.appealId ? `<div class="cl-id">Обращение #${escapeHtml(String(clientData.appealId).replace(/^#/, ''))}</div>` : ''}
            </div>
            <div class="cl-det">
              <span><i>Телефон</i>${escapeHtml(clientData.phone || '—')}</span>
              <span><i>Город</i>${escapeHtml(clientData.city || '—')}</span>
              ${clientData.address ? `<span><i>Адрес</i>${escapeHtml(clientData.address)}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
  ` : '';
  const clientBlockC = clientData ? `
      <div class="blk blk-client gap-m keep-next">
        <div class="client cp-client">
          <div class="cp-who">
            <span class="cl-ava" aria-hidden="true">${escapeHtml(clientInitial)}</span>
            <div class="cp-nm">
              <div class="cl-name">${escapeHtml(clientData.clientName || '—')}</div>
              ${clientData.appealId ? `<div class="cl-id">Обращение #${escapeHtml(String(clientData.appealId).replace(/^#/, ''))}</div>` : ''}
            </div>
          </div>
          <div class="cp-det">
            <i>Телефон</i><span>${escapeHtml(clientData.phone || '—')}</span>
            <i>Город</i><span>${escapeHtml(clientData.city || '—')}</span>
            ${clientData.address ? `<i>Адрес</i><span>${escapeHtml(clientData.address)}</span>` : ''}
          </div>
        </div>
      </div>
  ` : '';

  // Плашка акции. Тело с promoFromQty (целое; 2–20 проверяет route.js) — «от N изделий» жирным цветом акцента (.promo-cond). Тело без него (старые сметы) — «от 2 изделий»
  // обычным текстом, побайтно как раньше (golden)
  const promoOt = Number.isInteger(promoFromQty) ? promoFromQty : null;
  const promoText = promoOt === null
    ? `При заказе от 2 изделий действует скидка на весь заказ в размере ${promoDiscount}%`
    : `При заказе <b class="promo-cond">от ${promoOt} изделий</b> действует скидка на весь заказ в размере ${promoDiscount}%`;
  const promoBlock = promoDiscount ? `
      <div class="blk blk-promo">
        <div class="promo-banner">
          <span class="bn-ico">${ICO_PERCENT}</span>
          <span class="bn-txt">${promoText}</span>
        </div>
      </div>
  ` : '';

  const vatIncludedBlock = vatIncluded5 ? `
      <div class="blk blk-vat5">
        <div class="vat-included-banner">
          <span class="bn-ico">${ICO_RECEIPT}</span>
          <span class="bn-txt">Указанные цены уже включают НДС 5% (налог включён в стоимость).</span>
        </div>
      </div>
  ` : '';

  // знак скидки («−») и НДС («+») стоит у каждого числа диапазона («от −2 800 до −3 200 ₽»), а не перед «от» («−от 2 800 до 3 200 ₽»)
  const fmtRange = (min, max, sign = '') =>
    min === max
      ? `${sign}${rub(min)}`
      : `от ${sign}${num(min)} до ${sign}${rub(max)}`;

  const totalsRows = `
    <div class="totals-row">
      <span class="t-label">Количество позиций</span>
      <span class="t-value">${displayQtyStr} шт.</span>
    </div>
    ${hasAnyDiscount ? `
    <div class="totals-row">
      <span class="t-label">Сумма без скидки</span>
      <span class="t-value">${hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : rub(totalBasePrice)}</span>
    </div>
    <div class="totals-row discount-row">
      <span class="t-label">Скидка</span>
      <span class="t-value">${hasGroups ? fmtRange(displayDiscMin, displayDiscMax, '−') : '−' + rub(totalDiscountAmount)}</span>
    </div>
    <div class="totals-row">
      <span class="t-label">После скидки</span>
      <span class="t-value">${hasGroups ? fmtRange(displayAfterDiscMin, displayAfterDiscMax) : rub(totalAfterDiscount)}</span>
    </div>
    ` : `
    <div class="totals-row">
      <span class="t-label">Сумма</span>
      <span class="t-value">${hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : rub(totalBasePrice)}</span>
    </div>
    `}
    ${hasAnyVat ? `
    <div class="totals-row vat-row">
      <span class="t-label">НДС 22%</span>
      <span class="t-value">${hasGroups ? fmtRange(displayVatMin, displayVatMax, '+') : '+' + rub(totalVatAmount)}</span>
    </div>
    ` : ''}
    ${montageLine ? `
    <div class="totals-row montage-row">
      <span class="t-label">Монтаж</span>
      <span class="t-value">${montageLine}</span>
    </div>
    ` : ''}
  `;
  // компактный расчёт: те же строки, но сеткой 2 колонки — подпись мелко над значением
  const totalsCellsC = [
    ['', 'Количество позиций', `${displayQtyStr} шт.`],
    ...(hasAnyDiscount ? [
      ['', 'Сумма без скидки', hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : rub(totalBasePrice)],
      ['cp-disc', 'Скидка', hasGroups ? fmtRange(displayDiscMin, displayDiscMax, '−') : '−' + rub(totalDiscountAmount)],
      ['', 'После скидки', hasGroups ? fmtRange(displayAfterDiscMin, displayAfterDiscMax) : rub(totalAfterDiscount)],
    ] : [['', 'Сумма', hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : rub(totalBasePrice)]]),
    ...(hasAnyVat ? [['cp-vat', 'НДС 22%', hasGroups ? fmtRange(displayVatMin, displayVatMax, '+') : '+' + rub(totalVatAmount)]] : []),
    ...(montageLine ? [['cp-vat', 'Монтаж', montageLine]] : []),
  ];
  const totalsRowsC = totalsCellsC.map(([cls, label, value]) => `<div class="cp-tc ${cls}"><span class="t-label">${label}</span><span class="t-value">${value}</span></div>`).join('');

  // «Итого к оплате» (в нижней плитке, .tb-strip): диапазон — одной строкой «от … до … ₽», числа крупно; равные варианты — одно число (а, б)
  const finalRange = hasGroups && finalMin !== finalMax;
  const finalSingle = hasGroups ? finalMin : totalFinalItems + montageAmount;
  const finalValue = finalRange
    ? `<span class="tb-w">от</span> <b>${num(finalMin)}</b> <span class="tb-w">до</span> <b>${num(finalMax)}</b> <span class="tb-w">₽</span>`
    : `<b>${num(finalSingle)}</b> <span class="tb-w">₽</span>`;
  // очень длинная сумма (от миллиона и больше) — числа мельче, чтобы подпись и сумма остались в одной строке
  const finalLong = (finalRange ? num(finalMin).length + num(finalMax).length : num(finalSingle).length) > 14;

  // Связка .tail — поле содержимого последнего листа, плитка внизу. В связку входят «Расчёт стоимости», плашки, срок КП и плитка, а последняя карточка — только если вся
  // связка помещается в лист (иначе Chrome порвал бы её, а плитка осталась бы без расчёта): оценка высоты по правилам вёрстки этого файла
  // (строка расчёта 28,5 px, плашка 66,5 px с отступом, блок срока КП над плиткой — ряд TB_NOTE_H0 + строки пояснения (TB_NOTE_SUB_LH), плитка TB_TILE_H = 204 px, карточка — по числу строк
  // названия и материала; запас 6 px).
  const estLines = (text, perLine) => estLinesBy(text, perLine, (w) => w.length);
  const estCard = (item) => {
    const showDisc = hasAnyDiscount && item.discountPercent > 0;
    const showVat = hasAnyVat && item.vatEnabled;
    const showUnit = item.priceMode === 'unit'; // строка «N × цена ₽» над ценником (.cd-unit): 13 px × 1,25 = 16,25 + зазор 2 = 18,25 px (замер Chrome 20.10.2026, карточки A–D), а без скидки и НДС — ещё 4 px над итогом
    const left = estLines(item.productLabel, 22) * 20.1 + (item.materialName ? 2 + estLines(item.materialName, 30) * 18.9 : 0) + 6 + 21.5 + (razmeryTekst(item, num) ? 18.25 : 0); // 22 и 30 знаков в строке — по замерам печати (катал. образец: 4 строки названия, 4 материала); строка размеров .cd-size: 2 + 12,5 × 1,3 = 18,25 px
    const right = (showDisc ? 19 : 0) + (!showDisc && showVat ? 19.5 : 0) + (showDisc && showVat ? 19.5 : 0) + (showVat ? 17.6 : 0) + (showUnit ? 18.25 : 0) + (showDisc || showVat || showUnit ? 4 : 0) + 25.3;
    return 22 + Math.max(left, right);
  };
  const estRows = 1 + (hasAnyDiscount ? 3 : 1) + (hasAnyVat ? 1 : 0) + (montageLine ? 1 : 0);
  const estTotals = 48 + 28.5 * estRows + (montageLine && montageLine.includes('t-chip') ? 2.5 : 0) + 12; // замер печати: рамка 2 + шапка 36 + подол 11 + строки по 27,5 + разделители 1 = 48 + 28,5 × строк; чип в строке монтажа +2,5; 12 — отступ .gap-m
  const estBanners = (promoDiscount ? 66.5 : 0) + (vatIncluded5 ? 66.5 : 0); // замер печати: плашка в две строки 58,5 + 8 отступа
  // срок КП над плиткой — один левый блок: TB_NOTE_H0 (линия, отступ, метка, отступ) + основная строка (≈ 62 знака в строке 484 px при 13 px) + мелкая (если есть) + отступ до плитки
  const estMainLines = estLines(validityMain.replace(/<[^>]+>/g, ''), 62);
  const estNote = TB_NOTE_H0 + estMainLines * TB_NOTE_MAIN_LH + (validitySub ? TB_NOTE_SUB_GAP + TB_NOTE_SUB_LH + TB_NOTE_GAP : TB_NOTE_GAP_MAIN);
  const estTile = TB_TILE_H + 1 + estNote;
  // последняя карточка — в порядке показа (с помещениями он не равен порядку тела); если она первая в своей секции, вместе с ней в связку идёт заголовок помещения: ROOM_HEAD_H и по ROOM_LINE_H на каждую
  // лишнюю строку (≈ 46 знаков в строке заголовка 14 px / 700 при ширине 484 px за вычетом полей и «диска»)
  const lastShown = shown[shown.length - 1];
  const estRoomHead = lastShown?.sektsiya ? ROOM_HEAD_H + (estLines(`${lastShown.sektsiya.label} — ${roomSum(lastShown.sektsiya)}`, 46) - 1) * ROOM_LINE_H : 0;
  // компактный лист: свои оценки (числа — по замеру печати, см. CP_* ниже)
  const CPC = pc ? CP_PC : CP_A5; // числа формата (ширина колонки, листа)
  const estRowsC = Math.ceil(estRows / CPC.TOT_COLS);
  const estTotalsC = CPC.AIR_TOT + CP_TOT_HEAD + CP_TOT_PAD + CP_TOT_ROW * estRowsC + 8 + (montageLine && montageLine.includes('t-chip') ? 3 : 0);
  const estBannersC = ((promoDiscount ? 1 : 0) + (vatIncluded5 ? 1 : 0)) * CPC.BANNER_H;
  const estNoteC = TB_NOTE_H0 + estMainLines * TB_NOTE_MAIN_LH + (validitySub ? TB_NOTE_SUB_GAP + TB_NOTE_SUB_LH + CP_NOTE_GAP : CP_NOTE_GAP_MAIN);
  const estTileC = CP_TB_STRIP_H + CP_TB_DUSK_H + 1 + estNoteC;
  const estNeed = lastCardBlock !== '' ? estCard(lastShown.item) + estRoomHead + 8 + estTotals + estBanners + 8 + estTile : 0;
  // Компактный лист: в связку идут НЕСКОЛЬКО последних карточек — столько, сколько помещается в лист (оценка по CP_*), и ровно столько, чтобы тело до связки заняло наименьшее число листов
  const estClientC = clientData ? 80 + 17.5 * (Math.max(0, estLinesM(clientData.address || '', CPC.ADDR_CHARS) - 1) + Math.max(0, estLinesM(clientData.clientName || '', CPC.NAME_CLIENT_CHARS) - 1)) : 0;
  const cpBlocks = cardBlocks.concat(lastCardBlock ? [lastCardBlock] : []);
  const cpHeights = shown.map(({ item, sektsiya }) => estCardCompact(item, { hasAnyDiscount, hasAnyVat, num, rub, G: CPC }) + CP_BLOCK_GAP + (sektsiya ? CPC.AIR_ROOM + CP_ROOM_HEAD_H + (estLines(`${sektsiya.label} — ${roomSum(sektsiya)}`, 50) - 1) * CP_ROOM_LINE_H : 0));
  const cpTailBase = estTotalsC + estBannersC + estTileC;
  const lastInTail = lastCardBlock !== '' && estNeed <= TAIL_MIN_PX - 6;
  const { k: cpK, onePage } = compact ? planKompakta({ heights: cpHeights, clientH: estClientC, tailBase: cpTailBase, G: CPC }) : { k: 0, onePage: false };
  const cpBody = (onePage ? cpBlocks : cpBlocks.slice(0, cpBlocks.length - cpK)).join('\n  ');
  const cpTail = onePage ? '' : cpBlocks.slice(cpBlocks.length - cpK).join('\n    ');

  const totalsBlock = `
      <div class="blk blk-totals gap-m">
        <div class="totals-right">
          <div class="totals-header">${TH_ART}<div class="totals-header-text">Расчёт стоимости</div></div>
          ${compact ? `<div class="cp-tg">${totalsRowsC}</div>` : `<div class="totals-body">
            ${totalsRows}
          </div>`}
        </div>
      </div>
  `;

  const appealId = clientData?.appealId ? String(clientData.appealId) : '';
  // Левый край подвала: «SUNRAY · КП №010251» (решётку номера обращения «#» не пишем); без номера обращения — пусто
  // не длиннее 18 знаков: левый бокс подвала на A5 без города — половина колонки (242 px, с городом 76 % листа ≈ 388 px; на A4 шире), длинный номер перенёсся бы на вторую строку
  const appealNum = appealId.replace(/^#/, '').trim().slice(0, 18);
  const footerLeft = appealNum ? `SUNRAY · КП №${appealNum}${cityName ? ` · Объект: ${cityName}` : ''}` : '';
  // Заголовок страницы (Chrome кладёт его в PDF как Title): «Коммерческое предложение № 09784»; номер — как в подвале, без номера обращения — без номера
  const docTitle = appealNum ? `Коммерческое предложение № ${appealNum}` : 'Коммерческое предложение';

  const plashka = plashkaHtml({
    appealId,
    createdDay: createdDay ? днём(createdDay) : '',
    escapeHtml,
    logoWhite: LOGO_WHITE, // PNG с прозрачностью, белая надпись — на тёмную плитку
    city: cityName,
    compact,
    pc,
  });
  const bottomTile = tileHtml({
    finalValue,
    finalLong,
    validityNote,
    validityLastMain: !validitySub, // последняя строка блока срока — основная (форма А): зазор до плитки другой, см. TB_NOTE_GAP_MAIN
    siteHost,
    compact,
    pc,
  });

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=block" rel="stylesheet">
<style>
${getStyles({ footerLeft, promoCond: Boolean(promoDiscount) && promoOt !== null, unitRow: items.some((i) => i.priceMode === 'unit'), sizeRow: items.some((i) => razmeryTekst(i, num) !== ''), roomRows: Boolean(sektsii), compact, pc, city: Boolean(cityName) })}
</style>
</head>
<body${compact ? ` class="cp${pc ? ' pc' : ''}"` : ''}>
  ${onePage ? '<div class="one">' : ''}<div class="bleed">${plashka}</div>

  <div class="sheet">
  ${compact ? clientBlockC : clientBlock}

  ${compact ? cpBody : cardBlocks.join('\n  ')}
  ${compact ? '' : (lastInTail ? '' : lastCardBlock)}${onePage ? `
  ${totalsBlock}
  ${promoBlock}
  ${vatIncludedBlock}` : ''}
  </div>
${onePage ? `  ${bottomTile}
  </div>` : `
  <div class="tail">
    <div class="sheet">
    ${compact ? cpTail : (lastInTail ? lastCardBlock : '')}
    ${totalsBlock}
    ${promoBlock}
    ${vatIncludedBlock}
    </div>
    ${bottomTile}
  </div>`}
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═════════════════════════════════════════════════════════════════════════════
// Сменные модули визуала: у каждого модуля своя строка CSS и функция, возвращающая готовую HTML-строку; ширину колонки (484 px)
// и неразрывность даёт buildHtml, модуль в свою ширину не лезет. Только непрозрачные заливки. Исключение — плитки (верхняя и нижняя):
// они шире колонки — лист (560 px) минус боковые отступы PLATE_SIDE_MM, без теней.
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. Верхняя плитка с заголовком документа ──
// «Восход»: вся плитка — один тёмный изумруд, солнце на горизонте справа: его лучи идут в ламели сверху и растекаются тёплым сиянием по нижней (заголовочной) части.
// Зелёный не «казённый», а глубокий, и его оживляет тёплый свет. Золото — только тонкие линии арта (горизонт, обводка кольца солнца) и цвет № КП; вертикальных чёрточек
// у заголовка и у № нет. Слоган «Работаем с 2013 года» — просто белый текст под логотипом, без пилюли: на спокойном тёмном небе слева он читается без подложки;
// логотип — настоящий белый (LOGO_WHITE).
// Печать: только непрозрачное (сплошные цвета, линейные и радиальные градиенты с непрозрачными остановками, inline-SVG с clipPath), ни blur, ни теней, ни mask/filter,
// ни repeating-градиентов.
const PL_HA = 118; // верхняя часть: логотип, слоган, ламели и солнце
const PL_HB = 74; // нижняя часть: заголовок, № и дата
const PL_H = PL_HA + PL_HB; // высота плитки, px
const PL_GROUND = '#0f3a2c'; // нижняя часть слева (тёмный изумруд)
const PL_LOGO_W = 170; // ширина логотипа, px
const PL_ART_X = 264; // левее этой линии (от левого края плитки) небо ровное — на нём логотип (кончается на 188 px) и слоган «Работаем с 2013 года» (кончается на 241 px, зазор 23 px); сияние, линии и кольца только правее

const CSS_PLASHKA = `
  .pl, .pl * { box-sizing: border-box; margin: 0; padding: 0; }
  /* плитка уже листа на PLATE_SIDE_MM с каждой стороны (по центру, белые «ушки»), скруглены только нижние углы, верх вплотную к краю листа; overflow: hidden обрезает арт по ширине плитки */
  .pl {
    position: relative; width: ${PLATE_W_CSS}; margin: 0 ${PLATE_SIDE_MM}mm; height: ${PL_H}px;
    border-radius: 0 0 28px 28px; overflow: hidden; background: ${PL_GROUND};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .pl-bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
  .pl-art { position: relative; height: ${PL_HA}px; }
  .pl-brand { position: absolute; left: ${PLATE_PAD_MM}mm; top: 0; bottom: 0; width: max-content; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
  .pl-logo { display: block; width: ${PL_LOGO_W}px; height: auto; }
  .pl-tag {
    display: flex; align-items: center; height: 22px;
    font-size: 12.5px; font-weight: 800; line-height: 1; letter-spacing: 0.25em; text-transform: uppercase; color: #ffffff; white-space: nowrap;
  }
  .pl-tag span { margin-right: -0.25em; }
  .pl-band { position: relative; height: ${PL_HB}px; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 0 ${PLATE_PAD_MM}mm; }
  /* вертикальных черт нет ни у заголовка, ни у № / даты — заголовок и правый блок разделяет только свободное место; заголовок — одна строка обычным регистром 22 px / 600,
     левый край на поле 10 мм от края листа; № и дата справа, оба по центру зелёной зоны. Заголовок не сжимается и не переносится, а правый блок при нехватке места сокращается
     многоточием (min-width: 0 + overflow: hidden у строк) — наползти друг на друга они не могут */
  .pl-h { flex: none; font-size: 22px; font-weight: 600; line-height: 1.2; letter-spacing: 0.01em; color: #f6f1e6; white-space: nowrap; }
  .pl-meta { flex: 0 1 auto; min-width: 0; align-self: center; text-align: right; white-space: nowrap; }
  .pl-no { overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: 600; line-height: 1.2; letter-spacing: 0.04em; margin-right: -0.04em; color: #f6e2ae; }
  .pl-dt { overflow: hidden; text-overflow: ellipsis; margin-top: 2px; font-size: 12px; font-weight: 500; line-height: 1.2; color: #f0dba8; }
`;

// ── Общий язык арта обеих плиток: «восход» (верх) и «закат» (низ) ──
// Небо — плавный радиальный градиент вокруг солнца (вверху тёплый золотой / персиковый свет на холодном тиловом небе, внизу коралл / малина / слива); диск мягкий (радиальный градиент от светлой
// сердцевины, две тонкие кромки), над ним ореол — заливные кольца с малой прозрачностью (AR_HALO), они сливаются в сияние без чёткой кромки; «жалюзи» — три рассыпанных штриха на ряд, шаг 9 px,
// линии 1,3 px: светлые на тёмном небе и тёплые (lineD) на светлом — цвет по яркости неба в середине штриха (arLum), диск штрихи не пересекают.
// Восход (верх): золотая линия горизонта выходит из-под диска и гаснет; под горизонтом — земля и РЯБЬ (4 ряда волнистых штрихов, симметрично оси солнца, как волны логотипа).
// Закат (низ): встаёт из самого нижнего края блока (hor = H = TB_DUSK_H): диск срезан краем листа; ни земли, ни линии горизонта, ни ряби, ни полос под солнцем и под «Итого»;
// небо идёт до низа плюс 3 px вылета.
// Арт рисуется 1:1 на реальную ширину плитки PLATE_W_PX (лист 560 px минус два боковых отступа): viewBox равен размеру плитки, ничего не растягивается и не обрезается.
// Левее x0 у обеих плиток ровный фон: на нём текст (логотип и слоган; реквизиты); сияние, штрихи и кольца начинаются правее самого длинного текста с зазором ≥ 16 px.
// Печать: только непрозрачные градиенты; прозрачность — один fill-opacity / stroke-opacity на элемент (кольца ореола, штрихи, рябь); opacity на <g>, <svg> и в CSS нет (серых квадратов PDFKit нет);
// clipPath — простой rect; ни blur, ни теней, ни mask/filter, ни repeating-градиентов.
const arF = (v) => (+v).toFixed(2);
const arSt = (a) => a.map(([o, k]) => `<stop offset="${o}" stop-color="${k}"/>`).join('');
const arRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const arMix = (a, b, k) => { const x = arRgb(a), y = arRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
const arLum = (h) => { const [r, g, b] = arRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
// ореол: [добавка к радиусу солнца, px; fill-opacity], от внешнего кольца к внутреннему: 12 заливных кругов, ступени .013 → .032 сливаются в сияние
const AR_HALO12 = [[62, 0.013], [54, 0.014], [47, 0.016], [40, 0.018], [34, 0.02], [28.5, 0.022], [23.5, 0.024], [19, 0.026], [15, 0.028], [11.5, 0.03], [8.2, 0.031], [5, 0.032]];
// Каждое из 12 колец делится надвое: рядом добавлено промежуточное (по радиусу — посередине до внешнего соседа, у внешнего кольца +4 px), у обоих половина прозрачности — полная яркость сияния та же,
// а ступенька вдвое тоньше (по растру PDF в 400 % 12 колец давали ступеньки яркости 2–3 уровня, видные полосами в тиле и в фиолете); кольца по-прежнему от внешнего к внутреннему
const AR_HALO = AR_HALO12.flatMap(([d, a], i) => [[d + (AR_HALO12[i ? i - 1 : 0][0] - AR_HALO12[i ? i : 1][0]) / 2, a / 2], [d, a / 2]]);
function arScene(c) {
  // W,H — плитка; hor — линия, по которой режется солнце (восход: горизонт; закат: H, низ листа); sx,r — центр и радиус; up — на сколько радиусов центр выше hor;
  // x0 — левее ровный фон; ry — высота сияния; ground — земля под горизонтом (только восход; нет — небо идёт до низа плитки); ripple — рябь (только восход)
  const { W, H, hor, sx, r, up, x0, ry, id, cls } = c, f = arF, st = arSt;
  const cy = hor - up * r, rx = sx - x0, rg = r + 22, xL = x0, gold = '#f1d58e';
  const yb = c.ground ? hor : H + 3; // низ неба и сияния; у заката — край листа и 3 px вылета (против белой полоски при округлении Chrome)
  const o = (x) => ((x - xL) / (W - xL)).toFixed(3), cc = (q) => `cx="${f(sx)}" cy="${f(cy)}" r="${f(q)}"`;
  const skyAt = (t) => { let i = 1; while (i < c.sky.length - 1 && +c.sky[i][0] < t) i++; const [t0, c0] = c.sky[i - 1], [t1, c1] = c.sky[i]; return arMix(c0, c1, Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))); };
  let hd = '', hl = ''; // золотая линия горизонта (только восход): у диска золото, к краям переходит в цвет неба
  if (c.ground) {
    const tg = r / rx, side = (sg, tMax) => {
      const pts = [[tg, gold], [tg + 0.12, arMix(skyAt(tg + 0.12), gold, 0.45)]];
      if (tg + 0.3 < tMax) pts.push([tg + 0.3, skyAt(tg + 0.3)]);
      for (const [q] of c.sky) if (+q > tg + 0.3 && +q < tMax) pts.push([+q, skyAt(+q)]);
      pts.push([tMax, skyAt(tMax)]);
      return pts.map(([q, col]) => [sx + sg * q * rx, col]);
    };
    const hz = [...side(-1, 1).reverse(), ...side(1, (W - sx) / rx)].map(([x, col]) => [o(x), col]);
    hd = `<linearGradient id="${id}-h" gradientUnits="userSpaceOnUse" x1="${f(xL)}" y1="0" x2="${W}" y2="0">${st(hz)}</linearGradient>`;
    hl = `<rect x="${f(xL)}" y="${f(hor - 1.4)}" width="${f(W - xL)}" height="1.4" fill="url(#${id}-h)"/>`;
  }
  const L = [[], [], []], D = [[], [], []]; // жалюзи: штрихи по трём «рассыпанным» группам; светлые (L) и тёплые (D) — по яркости неба в середине штриха
  const dash = (g, x1, x2, y) => { const t = Math.min(1, Math.hypot(((x1 + x2) / 2 - sx) / rx, (y - cy) / ry)); (arLum(skyAt(t)) > 0.7 ? D : L)[g].push(`M${f(x1)} ${f(y)}H${f(x2)}`); };
  for (let k = 0; hor - 8 - 9 * k > cy - rg + 2; k++) {
    const y = hor - 8 - 9 * k, dy = y - cy, gh = Math.sqrt(Math.max(0, rg * rg - dy * dy)), xe = sx - gh;
    const len = (xe - (x0 + 12)) * (1 - 0.045 * k);
    [[0, 0.46], [0.53, 0.22], [0.84, 0.1]].forEach(([a, b], g) => dash(g, xe - len * (a + b), xe - len * a, y));
    dash(0, sx + gh, W + 2, y);
  }
  const pl = (a, col, op) => a.length ? `<path d="${a.join('')}" fill="none" stroke="${col}" stroke-width="1.3" stroke-linecap="round" stroke-opacity="${op}"/>` : '';
  const blinds = L.map((a, g) => pl(a, c.line, [0.34, 0.26, 0.18][g])).join('') + D.map((a, g) => pl(a, c.lineD, [0.34, 0.27, 0.2][g])).join('');
  const halo = AR_HALO.map(([d, a]) => `<circle ${cc(r + d)} fill="${c.bloom}" fill-opacity="${a}"/>`).join('');
  const edge = [[2.6, 0.12], [1.2, 0.22]].map(([d, a]) => `<circle ${cc(r + d)} fill="${c.rim}" fill-opacity="${a}"/>`).join('');
  // рябь под горизонтом: ряд = [опуск от горизонта, полуширина в r, число полуволн (нечётное), размах, цвет, прозрачность]; симметрично оси солнца
  const rip = (c.ripple || []).map(([dy, w, n, A, col, op], i) => {
    const hw = w * r, h2 = 2 * hw / n, s = i % 2 ? -1 : 1;
    return `<path d="M${f(sx - hw)} ${f(hor + dy)}q${f(h2 / 2)} ${f(-s * 2 * A)} ${f(h2)} 0${('t' + f(h2) + ' 0').repeat(n - 1)}" fill="none" stroke="${col}" stroke-width="1.15" stroke-linecap="round" stroke-opacity="${op}"/>`;
  }).join('');
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs>` +
    `<linearGradient id="${id}-b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">${st(c.base)}</linearGradient>` +
    `<radialGradient id="${id}-s" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${f(sx)} ${f(cy)}) scale(${f(rx)} ${f(ry)})">${st(c.sky)}</radialGradient>` +
    (c.ground ? `<radialGradient id="${id}-g" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${f(sx)} ${f(hor)}) scale(${c.gx} ${c.gy})">${st(c.ground)}</radialGradient>` : '') +
    `<radialGradient id="${id}-d" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${f(sx)} ${f(cy - 0.75 * r)}) scale(${f(2.4 * r)} ${f(1.9 * r)})">${st(c.disc)}</radialGradient>` +
    hd + `<clipPath id="${id}-c"><rect width="${W}" height="${f(yb)}"/></clipPath></defs>` +
    (c.ground ? `<rect y="${f(hor)}" width="${W}" height="${f(H - hor + 3)}" fill="url(#${id}-g)"/>` : '') +
    `<rect width="${W}" height="${f(yb)}" fill="url(#${id}-b)"/>` +
    `<rect x="${f(x0)}" width="${f(W - x0)}" height="${f(yb)}" fill="url(#${id}-s)"/>` + hl +
    `<g clip-path="url(#${id}-c)">${halo}${blinds}${edge}<circle ${cc(r + 15)} fill="none" stroke="#c9aa6e" stroke-width=".8" stroke-opacity=".6"/><circle ${cc(r)} fill="url(#${id}-d)"/></g>${rip}</svg>`;
}
// Восход: левее x0 небо ровное; земля — приглушённый зелёный; под горизонтом рябь
function artSunrise(W, H, o = {}) {
  const hor = o.hor ?? H * 0.6146; // 118 из 192
  return arScene({ W, H, hor, id: 'artsr', cls: o.cls || 'pl-bg', sx: W * 0.8071, r: o.r ?? W * 0.1037, up: 0.2, x0: o.x0 ?? W * 0.48, ry: hor, gx: 300, gy: 56,
    base: [[0, '#0a3337'], [1, '#0a3337']],
    sky: [[0, '#ffe9b0'], [0.34, '#fdc283'], [0.46, '#f8b78f'], [0.58, '#f4d0a8'], [0.68, '#b7d6c4'], [0.76, '#66aea9'], [0.85, '#24787f'], [0.93, '#124a5f'], [1, '#0a3337']],
    disc: [[0, '#fff4c8'], [0.14, '#ffeaa9'], [0.3, '#ffd986'], [0.45, '#ffc474'], [0.58, '#ffb065'], [0.7, '#ffa25c']],
    rim: '#ffcf86', bloom: '#fff1c9', line: '#fffaf0', lineD: '#c27a4a',
    ground: [[0, '#33704d'], [0.1, '#2b6a4a'], [0.22, '#236548'], [0.4, '#1c5f46'], [0.55, '#145c45'], [0.7, '#0f3a2c']],
    ripple: [[3.6, 1.12, 9, 1.7, '#ffe3a3', 0.44], [7.5, 0.9, 7, 1.4, '#f9cf92', 0.34], [11.6, 0.68, 5, 1.1, '#cfd09b', 0.24], [16, 0.46, 3, 0.9, '#8fc6a4', 0.16]] });
}
// Закат: встаёт из самого низа блока. Низ арта = нижний край (H = TB_DUSK_H); o.hor игнорируется, земли, горизонта и ряби нет
function artSunset(W, H, o = {}) {
  const x0 = o.x0 ?? W * 0.5357, r = o.r ?? W * 0.125, up = 0.14, hor = H, cy = hor - up * r; // up 0,14 → виден верх диска ≈57 %
  return arScene({ W, H, hor, id: 'artss', cls: o.cls || 'tb-bg', sx: W * 0.839, r, up, x0, ry: cy,
    base: [[0, '#0e3a30'], [0.11, '#0e3a30'], [(x0 / W).toFixed(4), '#2b1b3e'], [1, '#2b1b3e']],
    sky: [[0, '#ffd08a'], [0.4, '#ffc27c'], [0.52, '#fa9d68'], [0.64, '#ec6a76'], [0.74, '#bb4a80'], [0.84, '#7a3d82'], [0.92, '#43306f'], [0.97, '#33275f'], [1, '#2b1b3e']],
    disc: [[0, '#ffc27a'], [0.13, '#ffb36b'], [0.3, '#fb9a64'], [0.45, '#f4805f'], [0.55, '#ec6866'], [0.65, '#e0526f'], [0.8, '#c8447a']],
    rim: '#fb9a6e', bloom: '#ffd9a8', line: '#ffe8d8', lineD: '#b8534a' });
}

function plashkaHtml(ctx) {
  const { appealId, createdDay, escapeHtml, logoWhite, city = '', compact = false, pc = false } = ctx;
  const no = appealId ? `№ ${escapeHtml(String(appealId).replace(/^#/, ''))}` : '';
  const dt = createdDay ? `от ${createdDay}` : '';
  return `
    <div class="pl">
      ${compact ? artSunrise(pc ? PC_PLATE_W_PX : PLATE_W_PX, CP_PL_H, { hor: CP_PL_HA, cls: 'pl-bg', x0: PL_ART_X, r: pc ? 50 : PLATE_W_PX * 0.092 }) : artSunrise(PLATE_W_PX, PL_H, { hor: PL_HA, cls: 'pl-bg', x0: PL_ART_X })}
      <div class="pl-art">
        <div class="pl-brand">
          ${logoWhite ? `<img class="pl-logo" src="${escapeHtml(logoWhite)}" alt="SUNRAY">` : ''}
          <div class="pl-tag"><span>РАБОТАЕМ С 2013 ГОДА</span></div>
        </div>
      </div>
      <div class="pl-band">
        ${city ? `<div class="pl-hb"><h1 class="pl-h">Коммерческое предложение</h1><div class="pl-city">${CITY_ICO}<i>Объект</i><span>${escapeHtml(city)}</span></div></div>` : '<h1 class="pl-h">Коммерческое предложение</h1>'}
        ${no || dt ? `<div class="pl-meta">${no ? `<div class="pl-no">${no}</div>` : ''}${dt ? `<div class="pl-dt">${dt}</div>` : ''}</div>` : ''}
      </div>
    </div>`;
}

// ── 2. Карточка позиции ──────────────────────────────────────────────────────
// ctx = { hasAnyDiscount, hasAnyVat, groupColor, groupNum, rub, num, escapeHtml }.
// Слева «что»: № в круге, название, материал, «2 шт.», «Гр. N». Справа ОДНА колонка «сколько» («ценник») шириной 155 px, все строки по правому краю, состояния A–D (см. CSS_CARD).
// Цена — за позицию целиком, на количество не умножается, «×» нет. Правила показа: скидка при hasAnyDiscount && discountPercent > 0, НДС при hasAnyVat && vatEnabled; итог — finalPriceWithVat ?? discountedPrice.
// Нет скидки — нет чипа и зачёркнутой цены; нет НДС — нет строки НДС (итог и есть цена со скидкой, отдельной строки для неё нет). НДС без скидки: первой строкой идёт цена до НДС (без неё цена до налога из карточки пропала бы).
// Вид: карточка — «бумага» (--paper: мягкий свет из правого верхнего угла), один контур 1 px --hair, радиус 22; № — «диск» (цвет группы → её тёмный тон cdDeep, белая цифра); «N шт.» — тёплая пилюля без контура.
// «Ценник» — без плашки-подложки и без золота: итог 23 px / 700 — главный, зачёркнутая цена (1 px) и чип «−N%» — тихо, НДС — изумрудным; линии над итогом нет.
// Группа вариантов: свет карточки — тон группы (--cd-bg2 → --cd-bg), кант — тон группы с белым (--cd-line, cdMix 0,22), диск номера — цвет группы → её глубокий тон (--cd-lo, cdDeep), «Гр. N» — белый чип с точкой цвета группы.
// Ни теней, ни rgba.
const CSS_CARD = `
  .cd, .cd * { box-sizing: border-box; margin: 0; padding: 0; }
  .cd { --cd-main: #1c6b50; --cd-lo: #0f3a2c; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px; padding: 10px 16px; background: var(--paper); border: 1px solid var(--hair); border-radius: var(--r-block); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cd-g { background: radial-gradient(ellipse 110% 170% at 100% 0%, var(--cd-bg2) 0%, var(--cd-bg) 70%); border-color: var(--cd-line); }
  .cd-what { flex: 1 1 150px; min-width: 0; display: flex; align-items: flex-start; gap: 9px; }
  .cd-num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle at 32% 26%, var(--cd-main) 0%, var(--cd-lo) 100%); color: #ffffff; font-size: 13.5px; font-weight: 700; line-height: 28px; text-align: center; }
  .cd-txt { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .cd-name { font-size: 16.5px; font-weight: 700; line-height: 1.22; color: #0f3a2c; }
  .cd-mat { margin-top: 2px; font-size: 14.5px; font-weight: 400; line-height: 1.3; color: #625d56; }
  .cd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
  .cd-qty, .cd-gr { font-size: 13px; font-weight: 700; line-height: 1.2; white-space: nowrap; color: #0f3a2c; background: #f1ebdc; border-radius: 999px; padding: 3px 10px; }
  .cd-g .cd-qty, .cd-g .cd-gr { background: #ffffff; }
  .cd-gr { display: inline-flex; align-items: center; gap: 6px; padding-left: 8px; }
  .cd-gr::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--cd-main); }
  /* A — только итог; B (скидка) — старая цена + чип «−N%», итог; C (НДС) — «Цена …», «+ НДС …», итог; D (скидка и НДС) — старая цена + чип, цена со скидкой, «+ НДС …», итог. Подписи «ИТОГО» нет. */
  .cd-sum { flex: 0 0 155px; width: 155px; margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; text-align: right; }
  .cd-r1 { display: flex; align-items: center; justify-content: flex-end; gap: 8px; line-height: 1.2; }
  .cd-old { font-size: 12.5px; font-weight: 500; line-height: 1.2; color: #665f57; text-decoration: line-through; text-decoration-thickness: 1px; }
  .cd-off { font-size: 12.5px; font-weight: 700; line-height: 1.2; color: #a34a0b; background: #fff1e0; border-radius: 999px; padding: 1px 8px; }
  .cd-r2, .cd-pre { font-size: 14px; font-weight: 600; line-height: 1.25; color: #57534e; }
  .cd-vat { font-size: 12.5px; font-weight: 600; line-height: 1.25; color: #145c45; }
  .cd-fin { align-self: stretch; text-align: right; font-size: 23px; font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; color: #0f3a2c; }
  .cd-fin:not(:first-child) { margin-top: 4px; }
`;

// Непрозрачный «посветлее»: доля k цвета hex, остальное — белое (вместо hex+«55» с прозрачностью)
function cdMix(hex, k) {
  const n = parseInt(String(hex).slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(255 - (255 - v) * k).toString(16).padStart(2, '0')).join('');
}
// Непрозрачный «глубже»: цвет hex, умноженный на k (< 1) — тёмный тон группы для диска номера
function cdDeep(hex, k) { const n = parseInt(String(hex).slice(1), 16); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join(''); }

function cardHtml(item, idx, ctx) {
  const { hasAnyDiscount, hasAnyVat, groupColor, groupNum, rub, num, escapeHtml } = ctx;
  const showDisc = hasAnyDiscount && item.discountPercent > 0;
  const showVat = hasAnyVat && item.vatEnabled;
  const fin = item.finalPriceWithVat ?? item.discountedPrice;
  // Строки ценника по состояниям A–D (см. CSS_CARD); показ: скидка при hasAnyDiscount && discountPercent > 0,
  // НДС при hasAnyVat && vatEnabled, итог — finalPriceWithVat ?? discountedPrice. Без НДС итог и есть цена со скидкой — отдельной строки нет.
  const base = itemBase(item); // зачёркнутая цена и «Цена …» — база позиции: у «за штуку» price × quantity, у остальных price (разметка «за всю позицию» прежняя)
  const razmery = razmeryTekst(item, num); // «1 200 × 1 400 мм» мелко под материалом (буква В); размеров нет — пусто, разметка прежняя
  const rows = [];
  if (item.priceMode === 'unit') rows.push(`<div class="cd-unit">${num(item.quantity)} × ${rub(item.price)}</div>`);
  if (showDisc) rows.push(`<div class="cd-r1"><s class="cd-old">${rub(base)}</s><span class="cd-off">−${num(item.discountPercent)}%</span></div>`);
  if (showDisc && showVat) rows.push(`<div class="cd-r2">${rub(item.discountedPrice)}</div>`);
  if (!showDisc && showVat) rows.push(`<div class="cd-pre">Цена ${rub(base)}</div>`);
  if (showVat) rows.push(`<div class="cd-vat">+ НДС ${num(item.vatPercent || 22)}% · ${rub(item.vatAmount ?? 0)}</div>`);
  const style = groupColor ? ` style="--cd-main:${groupColor.label};--cd-bg:${groupColor.bg};--cd-line:${cdMix(groupColor.label, 0.22)};--cd-bg2:${cdMix(groupColor.label, 0.16)};--cd-lo:${cdDeep(groupColor.label, 0.72)}"` : '';
  return `<div class="cd${groupColor ? ' cd-g' : ''}"${style}>
      <div class="cd-what">
        <span class="cd-num">${idx + 1}</span>
        <div class="cd-txt">
          <div class="cd-name">${escapeHtml(item.productLabel)}</div>
          ${item.materialName ? `<div class="cd-mat">${escapeHtml(item.materialName)}</div>` : ''}${razmery ? `<div class="cd-size">${razmery}</div>` : ''}
          <div class="cd-meta"><span class="cd-qty">${num(item.quantity)} шт.</span>${groupNum != null ? `<span class="cd-gr">Гр. ${groupNum}</span>` : ''}</div>
        </div>
      </div>
      <div class="cd-sum">${rows.join('')}<div class="cd-fin">${rub(fin)}</div></div>
    </div>`;
}

// ── 3. Нижняя плитка: итог и реквизиты (срок КП — обычным текстом над ней) ────────────────────────
// «Закат»: зеркало верхней плитки — та же ширина (лист минус боковые отступы PLATE_SIDE_MM), те же 28 px скругления, но только СВЕРХУ; нижний край плоский и вплотную к низу листа (страница `final`, см. pageCss).
// Сверху вниз: (1) полоса «Итого к оплате» со скруглением сверху 28 px и суммой — своего фона нет, она лежит на фоне плитки TB_TOP_BG (изумруд → слива слева направо), который в точности повторяет верх неба заката,
// шов не виден; линии снизу нет; (2) «небо заката»: СЛЕВА гладкий непрозрачный фон (тёмный изумруд → слива, БЕЗ полос — реквизиты лежат на нём, как логотип на гладком небе верхней плитки), жалюзи и солнце — ТОЛЬКО в правой
// части (от x = TB_ART_X): закатная палитра (слива → фиолет → малина → коралл → персик), тот же шаг жалюзи, что у верхнего неба; солнце встаёт из самого нижнего края плитки: диск срезан краем листа, вокруг мягкий ореол из колец
// и тонкая золотая дуга; земли, линии горизонта и полос под солнцем нет.
// Реквизиты компании — мелко и вторично (10,5 / 11 px), слева на гладком фоне зоны заката; главное в плитке — «Итого к оплате». Подписи и печати компании в плитке нет.
// Шрифт Montserrat нигде не тяжелее 700: «Итого к оплате» 600, сумма 700, «от/до/₽» 500, строка срока 500 (дата 700), реквизиты 500–600.
// Печать: только непрозрачное (сплошные цвета, градиенты с непрозрачными остановками, inline-SVG с клипом), ни blur, ни теней, ни mask/filter,
// ни repeating-градиентов.
const TB_STRIP_H = 60; // полоса «Итого к оплате» (сумма 28 px, строка 31 px; сверху — скругление плитки 28 px), px
const TB_AIR = 4; // воздух над первой ламелью неба заката, px
const TB_DUSK_H = TB_AIR + 140; // зона заката, px: небо до самого нижнего края плитки (земли и горизонта нет, диск срезан нижним краем)
const TB_TILE_H = TB_STRIP_H + TB_DUSK_H; // вся плитка, px (оценка высоты связки .tail — estTile)
// срок КП над плиткой — один левый блок: линия 1 px → TB_NOTE_PAD → метка (10 px) → TB_NOTE_LAB_GAP → основная строка (13 px) → TB_NOTE_SUB_GAP → мелкая (12 px, только в виде «до») → TB_NOTE_GAP → плитка;
// отступы кратны 2–4 px; по этим же числам считается высота связки .tail (estTile)
const TB_NOTE_PAD = 8; // от линии-разделителя до метки «СРОК ПРЕДЛОЖЕНИЯ», px
const TB_NOTE_LAB_H = 12; // метка 10 px, строка 12 px
const TB_NOTE_LAB_GAP = 4; // от метки до основной строки, px
const TB_NOTE_MAIN_LH = 16; // основная строка 13 px, межстрочный ход 16 px (форма без срока «до» — обычно две строки)
const TB_NOTE_SUB_GAP = 2; // от основной строки до мелкой, px
const TB_NOTE_SUB_LH = 16; // мелкая строка 12 px, ход 16 px
const TB_NOTE_GAP = 18; // от мелкой строки («Смета составлена …», без выносных букв) до плитки, px (CSS); по растру от нижнего края текста до верха плитки ≈ 21,7 px
const TB_NOTE_GAP_MAIN = 20; // то же, когда последняя строка — основная (форма А: «формирования», «Дата» — выносные «ф», «р», «д» уходят ниже строки), px; по растру ≈ 20,3 px
const TB_NOTE_H0 = 1 + TB_NOTE_PAD + TB_NOTE_LAB_H + TB_NOTE_LAB_GAP; // линия + отступ + метка + отступ до основной строки, px
const TB_ART_X = 292; // сияние, линии и кольца — только правее этой линии (от левого края плитки); левее — ровный фон, на нём реквизиты. Самая длинная строка («ИНН … · ОГРНИП …») кончается на 274 px, зазор 18 px
// фон всей плитки = верх неба заката (шов с полосой «Итого»): слева изумруд #0e3a30, с 11 % ширины к x = TB_ART_X переходит в сливу #2b1b3e, дальше слива — та же шкала, что base у artSunset.
// Полоса «Итого» своего фона не имеет: она лежит на этом фоне, небо заката начинается с тех же цветов, шов не виден (светлой / тёмной полоски и золота нет);
// даже при дробной высоте в растре под швом тот же цвет, а не белое
const TB_TOP_BG = `linear-gradient(90deg, #0e3a30 0%, #0e3a30 11%, #2b1b3e ${(100 * TB_ART_X / PLATE_W_PX).toFixed(2)}%, #2b1b3e 100%)`;
const TB_REQ_TOP = 25; // верх блока реквизитов от верха зоны заката, px (блок ≈ 73 px, до горизонта ≈ 24 px)
const TB_REQ_W = 274; // ширина блока реквизитов, px (строки не переносятся; левее начала арта TB_ART_X)

const CSS_TILE = `
  .tb, .tb * { box-sizing: border-box; margin: 0; padding: 0; }
  /* плитка уже листа на PLATE_SIDE_MM с каждой стороны (по центру, белые «ушки»), скруглены только верхние углы, низ плоский и вплотную к низу листа */
  .tb {
    flex: none; width: ${PLATE_W_CSS}; margin: 0 ${PLATE_SIDE_MM}mm;
    border-radius: 28px 28px 0 0; background: ${TB_TOP_BG};
    break-inside: avoid; page-break-inside: avoid;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* срок КП — типографика на белом поле листа сразу над плиткой, без иконок, рамок и заливок и БЕЗ правой колонки: тонкая линия 1 px (цвет рамок листа) во всю ширину поля 10 мм →
     метка «СРОК ПРЕДЛОЖЕНИЯ» → основная строка (дата полужирная) → мелкая строка «Смета составлена …» (только в виде «до»). Связка .tail — flex-колонка высотой в поле содержимого
     последнего листа: margin-top:auto прижимает блок (и плитку за ним) к низу, плитка идёт сразу за блоком, между ними TB_NOTE_GAP; держится с плиткой */
  .tb-note {
    margin: auto 10mm ${TB_NOTE_GAP}px; padding-top: ${TB_NOTE_PAD}px; border-top: 1px solid #e8e2d3;
    break-after: avoid; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid;
  }
  .tb-note.tb-note-main { margin-bottom: ${TB_NOTE_GAP_MAIN}px; }
  .tb-vlab { font-size: 10px; font-weight: 600; line-height: ${TB_NOTE_LAB_H}px; letter-spacing: 0.12em; text-transform: uppercase; color: #145c45; }
  .tb-vmain { margin-top: ${TB_NOTE_LAB_GAP}px; font-size: 13px; font-weight: 500; line-height: ${TB_NOTE_MAIN_LH}px; color: #57534e; }
  .tb-vmain b { font-weight: 700; color: #0f3a2c; }
  .tb-vsub { margin-top: ${TB_NOTE_SUB_GAP}px; font-size: 12px; font-weight: 500; line-height: ${TB_NOTE_SUB_LH}px; color: #57534e; }
  /* полоса «Итого к оплате»: своего фона нет — лежит на фоне плитки TB_TOP_BG (изумруд → слива слева направо), который в точности повторяет верх неба заката; линии снизу нет,
     шов с зоной заката не виден; скругление сверху даёт .tb; текст — на поле 10 мм от края листа */
  .tb-strip {
    position: relative; min-height: ${TB_STRIP_H}px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 ${PLATE_PAD_MM}mm;
  }
  .tb-label { position: relative; font-size: 15px; font-weight: 600; line-height: 1.2; color: #f3ede2; white-space: nowrap; }
  .tb-amount { position: relative; margin-left: auto; text-align: right; white-space: nowrap; color: #ffffff; }
  .tb-amount b { font-size: 28px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .tb-amount .tb-w { font-size: 15px; font-weight: 500; color: #d9d0c0; }
  .tb-amount.tb-long b { font-size: 24px; }
  /* арт (SVG ровно по ширине плитки) не растягивается; clip-path режет только то, что вылезло бы по бокам (линии выходят за край на 2 px), а вниз оставляет запас 4 px — небо продолжено под рамку SVG, см. ниже */
  .tb-dusk { position: relative; height: ${TB_DUSK_H}px; clip-path: inset(0 0 -4px 0); }
  /* overflow: visible — небо арта продолжено на 3 px ниже рамки SVG (только краска, раскладку не меняет): Chrome привязывает нижний край плитки к целому пикселю (793 из 793,28
     у страницы A5), и без запаса у самого низа последнего листа остаётся белая полоска ≈ 0,3 px. Скругление сверху плитки даёт сама .tb и её полоса (.tb-strip), overflow: hidden не нужен */
  .tb-bg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; overflow: visible; }
  /* реквизиты — вторичный текст: ИП, ИНН, контакты 10,5 px, ФИО 11 px;
     главное в плитке — «Итого к оплате». Лежат на ровном фоне левее x = TB_ART_X (сияния, линий и колец там нет); контраст ≥ 4,5:1 */
  .tb-req { position: absolute; left: ${PLATE_PAD_MM}mm; top: ${TB_REQ_TOP}px; width: ${TB_REQ_W}px; }
  .tb-ip { font-size: 10.5px; font-weight: 500; line-height: 1.25; color: #c4bdb0; }
  .tb-fio { margin-top: 1px; font-size: 11px; font-weight: 600; line-height: 1.25; color: #f3ede2; white-space: nowrap; }
  .tb-ln { display: flex; flex-wrap: nowrap; gap: 0 5px; margin-top: 2px; font-size: 10.5px; font-weight: 500; line-height: 1.25; color: #e4ddd0; white-space: nowrap; }
  .tb-ln i { font-style: normal; font-weight: 600; letter-spacing: 0.04em; color: #b8ad98; }
  .tb-ln a { color: inherit; text-decoration: none; }
  .tb-dot { color: #bfa468; }
`;

// ── Город объекта (cityContext: { name, siteHost }) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Менеджер выбирает город сметы (Истра, Люберцы…): лист показывает «Объект Истра» в трёх местах (вариант «подзаголовок»: вторая строка шапки, метка справа над итогом, подвал «… · Объект: Истра»), а строка сайта
// в реквизитах ведёт на поддомен города (istra.zhalyuzi-sunray.ru). Юридические реквизиты ИП не меняются никогда. Только именительный падеж и только со словом «Объект»: голая «Истра» рядом с датой читается
// как «место составления». Хост приходит из тела запроса, поэтому проходит белый список (только zhalyuzi-sunray.ru и его поддомены), иначе — основной сайт. Нет города — вёрстка и CSS побайтно прежние (golden).
const SITE_HOST_MAIN = 'zhalyuzi-sunray.ru';
const SITE_HOST_RE = /^([a-z0-9-]{1,40}\.)?zhalyuzi-sunray\.ru$/;
// В названии города есть хоть один ВИДИМЫЙ знак: имя из одних невидимых (U+200B, U+2060, U+3164, U+2800 и т. п.) городом не считается — иначе в шапке стояло бы «ОБЪЕКТ» без названия
const VIDIMOE_RE = /[^\p{Cf}\p{Cc}\p{Z}\u034f\u115f\u1160\u2800\u3164\uffa0\ufe00-\ufe0f]/u;
const CITY_SHOW_MAX = 18; // знаков города на листе: самое длинное название справочника — 17 («Лосино-Петровский»); подвал 12 px в одну строку, левая колонка 76 % листа (≈ 142 px под город). Одна и та же строка в шапке, метке и подвале
// Длиннее max: режем по границе слова или дефиса (не меньше 5 знаков слева), убираем висячие слова до двух букв («и», «на», «в») и ставим «…»: «Красная Пахра-на-Оке и далее» → «Красная Пахра…»
const cityDlya = (name, max) => {
  const a = Array.from(name);
  if (a.length <= max) return name;
  let s = a.slice(0, max - 1);
  if (/[\p{L}\p{N}]/u.test(a[max - 1])) { // разрез посреди слова — откат к границе
    const i = s.findLastIndex((c) => c === ' ' || c === '-');
    if (i >= 5) s = s.slice(0, i);
  }
  let t = s.join('').replace(/[\s\p{Pd},.;:]+$/u, '');
  while (Array.from(t).length > 5 && /[\s\p{Pd},.;:]\p{L}{1,2}$/u.test(t)) t = t.replace(/[\s\p{Pd},.;:]+\p{L}{1,2}$/u, '');
  return t === '' ? '' : `${t}…`; // одни разделители — города нет
};

/** @returns {{ name: string, host: string }} — name '' = города нет; host — всегда из белого списка */
function gorodObekta(cityContext) {
  const raw = cityContext && typeof cityContext === 'object' && typeof cityContext.name === 'string' ? cityContext.name : '';
  const name = VIDIMOE_RE.test(raw) ? cityDlya(raw.replace(/\s+/g, ' ').trim(), CITY_SHOW_MAX) : '';
  const host = name && typeof cityContext.siteHost === 'string' && SITE_HOST_RE.test(cityContext.siteHost) ? cityContext.siteHost : SITE_HOST_MAIN;
  return { name, host };
}

// ромб из логотипа с точкой-солнцем, 8 × 12, цвет — currentColor
const CITY_ICO = '<svg class="city-ico" viewBox="0 0 8 12" aria-hidden="true" focusable="false"><path d="M4 .6 7.4 5.3 4 11.4.6 5.3Z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="4" cy="5.3" r="1.25" fill="currentColor"/></svg>';

// Идёт в самый конец CSS (после .pl-*, .tb-vlab и компактных правил: «.pl * { padding: 0 }» иначе перебьёт). Высоту строки срока метка не меняет (line-height как у «СРОК ПРЕДЛОЖЕНИЯ»), связка .tail считается как прежде
const CSS_CITY = `
  .city-ico { flex: none; display: block; width: 8px; height: 12px; }
  .pl-hb { flex: none; display: flex; flex-direction: column; padding-bottom: 7px; } /* 7 px: заголовок встаёт на линию «№», город — на линию даты */
  .pl-city { display: flex; align-items: center; gap: 6px; max-width: 340px; font-size: 12px; font-weight: 500; line-height: 14.4px; color: #f0dba8; white-space: nowrap; }
  .pl-city .city-ico, .pl-city i { color: #bfa468; }
  .pl-city i { flex: none; font-style: normal; font-size: 10px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; }
  .pl-city span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tb-vlab-city { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .tb-city { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 58%; font-size: 12px; line-height: ${TB_NOTE_LAB_H}px; letter-spacing: 0; text-transform: none; color: #0f3a2c; white-space: nowrap; }
  .tb-city .city-ico, .tb-city i { color: #145c45; }
  .tb-city i { flex: none; font-style: normal; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
  .tb-city b { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .cp .pl-hb { padding-bottom: 3px; }
  .pc .pl-hb { padding-bottom: 5px; } /* ПК: город на линии даты, заголовок на линии «№» (разбор дизайнера 20.10.2026: было ≈ 3 px ниже) */
  .cp .pl-city { font-size: 11px; line-height: 13px; gap: 5px; }
  .cp .pl-city i { font-size: 9px; }
`;

// ctx = { finalValue, finalLong, validityNote, validityLastMain }. Разметка — два соседа в связке .tail: текст срока КП (.tb-note) и плитка (.tb)
function tileHtml(ctx) {
  const { finalValue, finalLong, validityNote, validityLastMain, siteHost = SITE_HOST_MAIN, compact = false, pc = false } = ctx;
  return `
    <div class="tb-note${validityLastMain ? ' tb-note-main' : ''}">${validityNote}</div>
    <div class="tb">
      <div class="tb-strip">
        <span class="tb-label">Итого к оплате</span>
        <span class="tb-amount${finalLong ? ' tb-long' : ''}">${finalValue}</span>
      </div>
      <div class="tb-dusk">
        ${compact ? artSunset(pc ? PC_PLATE_W_PX : PLATE_W_PX, CP_TB_DUSK_H, { cls: 'tb-bg', x0: TB_ART_X, r: pc ? 58 : PLATE_W_PX * 0.108 }) : artSunset(PLATE_W_PX, TB_DUSK_H, { cls: 'tb-bg', x0: TB_ART_X })}
        <div class="tb-req">
          <div class="tb-ip">Индивидуальный предприниматель</div>
          <div class="tb-fio">Журович-Миронова Дарья Васильевна</div>
          <div class="tb-ln"><span><i>ИНН</i> 910502074977</span><span class="tb-dot">·</span><span><i>ОГРНИП</i> 321911200058121</span></div>
          <div class="tb-ln"><a href="tel:+79998107717">+7 (999) 810-77-17</a><span class="tb-dot">·</span><a href="mailto:sunray-zhalyuzi@yandex.ru">sunray-zhalyuzi@yandex.ru</a></div>
          <div class="tb-ln"><a href="https://${siteHost}/">${siteHost}</a></div>
        </div>
      </div>
    </div>`;
}


// ── Компактный лист (CP_*): та же фирменная вёрстка, блоки собраны плотнее. Только под compact (sheet === 'compact' или 'pc'; CP_PC, CSS_PC, PC_PLATE_W_PX — только под 'pc'); большой лист не затронут ──
const CP_PL_HA = 92; // верх плитки-восхода: логотип, слоган, солнце, px (было 118)
const CP_PL_HB = 52; // низ: заголовок, № и дата, px (было 74)
const CP_PL_H = CP_PL_HA + CP_PL_HB; // 144 вместо 192
const CP_TB_STRIP_H = 48; // полоса «Итого к оплате» (было 60)
const CP_TB_DUSK_H = 116; // зона заката (было 144)
const CP_BLOCK_GAP = 6; // воздух между блоками, px
const CP_PACK_SAFE = 1.03; // запас на оценку при подсчёте листов тела (ошибка только добавит лист, связку не ломает)
const CP_TAIL_SAFE = 8; // запас связки, px
const CP_TAIL_SAFE_PER_CARD = 18; // и ещё по 18 px на каждую карточку в связке: оценка высоты карточки (estCardCompact) бывает занижена на строку (12–18 px, замер проверяющих 20.10.2026: длинное название и крупные цены с НДС дают третью строку названия), а связка не имеет права не влезть на последний лист; тело листов ошибка оценки не ломает, только число листов
const PC_PLATE_W_PX = +(793.33 - 2 * PLATE_SIDE_MM * 96 / 25.4).toFixed(2); // плитка на листе A4: 595 pt = 793,33 px (793,7 — это 210 мм, а страница у нас в точках) минус два боковых отступа
const CP_ONE_SAFE = 40; // запас при проверке «вся смета на одном листе», px (две занижённые на строку карточки — 2 × 16 px — не должны вытолкнуть смету на второй лист)
// числа формата: A5 (компакт) и A4 (ПК): сколько места под карточки, сколько знаков в строке, сколько колонок у расчёта
const CP_A5 = { PC: false, FIN_H: 22, AIR_TOT: 0, AIR_ROOM: 0, FIRST_FIELD: 733, NEXT_FREE: 687 - 4, TAIL: TAIL_MIN_PX, ONE: 0, NAME_CHARS: 30, SUB_CHARS: 40, TOT_COLS: 2, BANNER_H: 51, ADDR_CHARS: 24, NAME_CLIENT_CHARS: 22 };
const CP_PC = { PC: true, FIN_H: 24, AIR_TOT: 8, AIR_ROOM: 8, FIRST_FIELD: 1062, NEXT_FREE: 1016 - 4, TAIL: 1076, ONE: 1121, NAME_CHARS: 40, SUB_CHARS: 62, TOT_COLS: 3, BANNER_H: 38, ADDR_CHARS: 34, NAME_CLIENT_CHARS: 30 };
const CP_NAME_LH = 17.7; // строка названия, px
const CP_SUB_LH = 16.3; // строка «материал · размеры», px
const CP_R1_H = 15; // «старая цена −N %»
const CP_R2_H = 16; // «цена со скидкой + НДС»
const CP_CARD_PAD = 18; // отступы 2 × 8 + рамка 2
const CP_TOT_HEAD = 30; // шапка «Расчёта стоимости»
const CP_TOT_PAD = 6; // подол блока
const CP_TOT_ROW = 44; // ряд сетки расчёта: подпись 11 px + значение 14 px + отступы (замер печати: блок 79 px при одном ряду, 167 при трёх)
const CP_NOTE_GAP = 12;
const CP_NOTE_GAP_MAIN = 14;
const CP_ROOM_LINE_H = 17;
const CP_ROOM_HEAD_H = 28;

const CSS_PC = `
  /* ── Формат «ПК»: лист A4 (595 × 842 pt) — то же оформление и та же плотная вёрстка; обычная смета влезает на один лист ── */
  .pc .tail { min-height: ${CP_PC.TAIL}px; }
  .pc .tb { background: linear-gradient(90deg, #0e3a30 0%, #0e3a30 11%, #2b1b3e ${(100 * TB_ART_X / PC_PLATE_W_PX).toFixed(2)}%, #2b1b3e 100%); }
  .pc .pl-logo { width: 170px; }
  .pc .pl-tag { font-size: 12px; height: 20px; }
  .pc .pl-h { font-size: 21px; }
  .pc .cp-fin { font-size: 22px; }
  .pc .tb-label { font-size: 14.5px; }
  .pc .tb-amount b { font-size: 27px; }
  .pc .tb-amount.tb-long b { font-size: 23px; }
  .pc .blk-totals { margin-top: 14px; }
  .pc .blk-card + .blk-rhead { margin-top: 14px; }
  .pc .cp-pl { gap: 2px; }
  .pc .one { page: one; display: flex; flex-direction: column; height: ${CP_PC.ONE}px; }
  .pc .one > .sheet { flex: none; }
  .pc .cp-price { flex-direction: row; align-items: center; gap: 14px; }
  .pc .cp-pl { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
  .pc .cp-tg { grid-template-columns: repeat(3, 1fr); }
  .pc .cp-tc:nth-child(n+3) { border-top: 0; }
  .pc .cp-tc:nth-child(n+4) { border-top: 1px solid #eee8d9; }
  .pc .cp-tc:not(:nth-child(3n+1)) { padding-left: 0; }
  .pc .promo-banner, .pc .vat-included-banner { padding: 4px 12px 4px 8px; }
`;

const CSS_COMPACT = `
  /* ── Компактный лист ── блоки собраны плотнее, фирменный вид тот же: клиент в две колонки, карточка — сетка «номер | название и мелочь | цены», расчёт — сеткой 2 × N,
     плашки в одну-две тонкие строки, плитки ниже (шапка 144 вместо 192, низ 164 вместо 204). Деньги и «шт.» не мельче 11 px, метки и реквизиты не мельче 10 px. */
  .cp .bleed { margin-bottom: 8px; }
  .cp .blk { margin-bottom: 6px; }
  .cp .blk.gap-m { margin-bottom: 8px; }
  .cp .blk-card + .blk-rhead { margin-top: 6px; }
  /* верхняя плитка */
  .cp .pl { height: ${CP_PL_H}px; }
  .cp .pl-art { height: ${CP_PL_HA}px; }
  .cp .pl-band { height: ${CP_PL_HB}px; }
  .cp .pl-logo { width: 150px; }
  .cp .pl-brand { gap: 5px; }
  .cp .pl-tag { height: 18px; font-size: 11px; }
  .cp .pl-h { font-size: 19px; }
  .cp .pl-no { font-size: 13.5px; }
  .cp .pl-dt { margin-top: 1px; font-size: 11px; }
  /* клиент: слева аватар + имя + «Обращение», справа три строки «подпись — значение» */
  .cp .cp-client { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.06fr); gap: 0 14px; align-items: center; padding: 8px 14px; border-radius: 18px; }
  .cp .cp-who { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .cp .cl-ava { width: 32px; height: 32px; margin-top: 0; font-size: 14px; }
  .cp .cp-nm { min-width: 0; }
  .cp .cl-name { font-size: 14.5px; line-height: 1.2; }
  .cp .cl-id { display: inline-block; max-width: 100%; margin-top: 3px; padding: 2px 8px 3px; font-size: 11px; }
  .cp .cp-det { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 1px 8px; align-items: baseline; font-size: 12.5px; line-height: 1.35; overflow-wrap: anywhere; }
  .cp .cp-det i { font-style: normal; font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: #145c45; white-space: nowrap; margin: 0; }
  /* карточка позиции */
  .cp .cd { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 0 9px; align-items: start; padding: 8px 14px; border-radius: 18px; }
  .cp .cd-num { width: 24px; height: 24px; font-size: 12px; line-height: 24px; }
  .cp .cp-main { min-width: 0; overflow-wrap: anywhere; }
  .cp .cp-name { font-size: 14.5px; font-weight: 700; line-height: 1.22; color: #0f3a2c; }
  .cp .cp-name .cd-qty, .cp .cp-name .cd-gr { margin-left: 5px; padding: 1px 7px; font-size: 11px; vertical-align: 1px; }
  .cp .cp-name .cd-gr { padding-left: 6px; }
  .cp .cp-sub { margin-top: 1px; font-size: 12.5px; font-weight: 400; line-height: 1.3; color: #625d56; }
  .cp .cp-price { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; white-space: nowrap; text-align: right; }
  .cp .cp-pl { display: contents; }
  .cp .cp-r1 { display: flex; align-items: center; justify-content: flex-end; gap: 6px; line-height: 1.2; }
  .cp .cp-r1 .cd-old { font-size: 11.5px; }
  .cp .cp-r1 .cd-off { font-size: 11.5px; padding: 0 7px; }
  .cp .cp-r2 { font-size: 12.5px; font-weight: 600; line-height: 1.3; color: #57534e; }
  .cp .cp-r2 em { font-style: normal; font-size: 11.5px; font-weight: 600; color: #145c45; }
  .cp .cp-fin { font-size: 20px; font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; color: #0f3a2c; }
  /* заголовок помещения */
  .cp .rm { padding: 2px 12px; margin-bottom: 5px; font-size: 13px; line-height: ${CP_ROOM_LINE_H}px; border-radius: 12px; }
  .cp .rm::before { margin-top: 5px; }
  /* расчёт стоимости: сетка 2 колонки, подпись над значением */
  .cp .totals-header { padding: 6px 14px; }
  .cp .totals-header-text { font-size: 13.5px; }
  .cp .cp-tg { display: grid; grid-template-columns: 1fr 1fr; column-gap: 14px; padding: 1px 14px 5px; }
  .cp .cp-tc { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 5px 0; }
  .cp .cp-tc:nth-child(n+3) { border-top: 1px solid #eee8d9; }
  .cp .cp-tc .t-label { font-size: 11px; line-height: 1.25; color: #625d56; }
  .cp .cp-tc .t-value { font-size: 14px; line-height: 1.3; font-weight: 700; color: #0f3a2c; text-align: left; }
  .cp .cp-tc.cp-disc .t-label, .cp .cp-tc.cp-disc .t-value { color: #a34a0b; }
  .cp .cp-tc.cp-vat .t-label, .cp .cp-tc.cp-vat .t-value { color: #145c45; }
  /* плашки акции и НДС */
  .cp .promo-banner, .cp .vat-included-banner { gap: 9px; padding: 5px 12px 5px 8px; border-radius: 16px; font-size: 12.5px; line-height: 1.3; }
  .cp .bn-txt { text-wrap: balance; }
  .cp .bn-ico { width: 22px; height: 22px; }
  .cp .bn-ico svg { width: 13px; height: 13px; }
  /* срок КП и нижняя плитка */
  .cp .tb-note { margin-bottom: ${CP_NOTE_GAP}px; }
  .cp .tb-note.tb-note-main { margin-bottom: ${CP_NOTE_GAP_MAIN}px; }
  .cp .tb-vmain { font-size: 12.5px; }
  .cp .tb-strip { min-height: ${CP_TB_STRIP_H}px; }
  .cp .tb-label { font-size: 13.5px; }
  .cp .tb-amount b { font-size: 24px; }
  .cp .tb-amount .tb-w { font-size: 13px; }
  .cp .tb-amount.tb-long b { font-size: 21px; }
  .cp .tb-dusk { height: ${CP_TB_DUSK_H}px; }
  .cp .tb-req { top: 12px; }
  .cp .tb-ip, .cp .tb-ln { font-size: 10px; }
  .cp .tb-fio { font-size: 10.5px; }
`;

// Строки текста в колонке perLine знаков: общий цикл для обоих листов. Большой лист меряет слово его длиной (estLines в buildHtml — число замеров калибровано так, golden не менять),
// компактный — шириной букв: заглавные и «широкие» шире строчных, а оценка откалибрована на строчных (иначе «ЖАЛЮЗИ ГОРИЗОНТАЛЬНЫЕ» занижается на строку)
function estLinesBy(text, perLine, widthOf) {
  let lines = 1, cur = 0;
  for (const w of String(text || '').split(/\s+/).filter(Boolean)) {
    const l = widthOf(w);
    if (cur === 0) cur = l;
    else if (cur + 1 + l <= perLine) cur += 1 + l;
    else { lines++; cur = l; }
    while (cur > perLine) { lines++; cur -= perLine; }
  }
  return lines;
}
const estWidthM = (w) => Array.from(w).reduce((a, ch) => a + (ch !== ch.toLowerCase() ? 1.3 : /[шщжфюмыъ]/.test(ch) ? 1.1 : 1), 0);
const estLinesM = (text, perLine) => estLinesBy(text, perLine, estWidthM);

/**
 * Раскладка компактного листа по оценкам высот (px). Возвращает:
 *   k — сколько ПОСЛЕДНИХ карточек идёт в связку .tail вместе с расчётом, плашками, сроком и плиткой (не меньше одной, пока карточек больше одной; 0 — одна карточка в смете
 *       или даже одна не влезает в связку): берём то k, при котором тело до связки занимает наименьшее число листов (при равенстве — меньшее k, оно оставляет связке запас);
 *   onePage — формат «ПК»: вся смета (шапка, клиент, карточки, расчёт, плашки, срок, плитка) помещается на один лист и печатается без деления на тело и связку.
 * @param {{ heights: number[], clientH: number, tailBase: number, G: typeof CP_A5 }} a — heights: высота каждой карточки с воздухом и заголовком помещения; clientH: плитка клиента;
 *   tailBase: расчёт + плашки + срок + плитка; G: числа формата (CP_A5 | CP_PC)
 * @returns {{ k: number, onePage: boolean }}
 */
function planKompakta({ heights, clientH, tailBase, G }) {
  const n = heights.length;
  const packPages = (hs) => { // листы, которые займут карточки: первый лист — поле минус шапка и клиент, следующие — поле целого листа
    let pages = 1, free = G.FIRST_FIELD - (CP_PL_H + 8) - (clientH + 8) - 4;
    for (const h of hs) { if (h > free) { pages++; free = G.NEXT_FREE; } free -= h; }
    return pages;
  };
  let k = 0;
  if (n > 1) {
    let best = Infinity;
    for (let tryK = 1; tryK <= n - 1; tryK++) {
      const tailH = heights.slice(n - tryK).reduce((a, b) => a + b, 0) + tailBase;
      if (tailH > G.TAIL - CP_TAIL_SAFE - CP_TAIL_SAFE_PER_CARD * tryK) break; // дальше только больше
      const pages = packPages(heights.slice(0, n - tryK).map((h) => h * CP_PACK_SAFE));
      if (pages < best) { best = pages; k = tryK; }
    }
  }
  const oneH = (CP_PL_H + 8) + clientH + 8 + heights.reduce((a, b) => a + b, 0) + tailBase;
  return { k, onePage: G.PC && oneH <= G.ONE - CP_ONE_SAFE };
}

// Оценка высоты компактной карточки, px (по замеру печати; числа CP_*)
function estCardCompact(item, { hasAnyDiscount, hasAnyVat, num, rub, G = CP_A5 }) {
  const showDisc = hasAnyDiscount && item.discountPercent > 0;
  const showVat = hasAnyVat && item.vatEnabled;
  const sub = [item.materialName, razmeryTekst(item, num), item.priceMode === 'unit' ? `${num(item.quantity)} × ${rub(item.price)}` : ''].filter(Boolean).join(' · ');
  const left = estLinesM(`${item.productLabel} ${num(item.quantity)} шт.${item.groupId ? ' Гр. 1' : ''}`, G.NAME_CHARS) * CP_NAME_LH + (sub ? 1 + estLinesM(sub, G.SUB_CHARS) * CP_SUB_LH : 0);
  const rows = (showDisc ? 1 : 0) + (showVat ? 1 : 0) + 1;
  const right = G.PC ? Math.max((showDisc ? CP_R1_H : 0) + (showVat ? CP_R2_H : 0) + (showDisc && showVat ? 1 : 0), G.FIN_H) : (showDisc ? CP_R1_H : 0) + (showVat ? CP_R2_H : 0) + G.FIN_H + (rows - 1);
  return CP_CARD_PAD + Math.max(left, right);
}

// Компактная карточка позиции: слева № и название (с «N шт.» и «Гр. N» чипами в строке названия) и мелкая строка «материал · размеры · N × цена»; справа цены в три строки не больше:
// «старая цена −N %», «цена со скидкой + НДС» одной строкой, итог крупно. Состояния те же, что у большой (A–D, цена за штуку, размеры, группа).
function cardHtmlCompact(item, idx, ctx) {
  const { hasAnyDiscount, hasAnyVat, groupColor, groupNum, rub, num, escapeHtml } = ctx;
  const showDisc = hasAnyDiscount && item.discountPercent > 0;
  const showVat = hasAnyVat && item.vatEnabled;
  const fin = item.finalPriceWithVat ?? item.discountedPrice;
  const base = itemBase(item);
  const razmery = razmeryTekst(item, num);
  const sub = [item.materialName ? escapeHtml(item.materialName) : '', razmery, item.priceMode === 'unit' ? `${num(item.quantity)} × ${rub(item.price)}` : ''].filter(Boolean).join(' · ');
  const rows = [];
  if (showDisc) rows.push(`<div class="cp-r1"><s class="cd-old">${rub(base)}</s><span class="cd-off">−${num(item.discountPercent)}%</span></div>`);
  if (showVat) rows.push(`<div class="cp-r2">${showDisc ? rub(item.discountedPrice) : rub(base)} <em>+ НДС${(item.vatPercent || 22) !== 22 ? ` ${num(item.vatPercent)}%` : ''} ${rub(item.vatAmount ?? 0)}</em></div>`);
  const style = groupColor ? ` style="--cd-main:${groupColor.label};--cd-bg:${groupColor.bg};--cd-line:${cdMix(groupColor.label, 0.22)};--cd-bg2:${cdMix(groupColor.label, 0.16)};--cd-lo:${cdDeep(groupColor.label, 0.72)}"` : '';
  return `<div class="cd${groupColor ? ' cd-g' : ''}"${style}>
      <span class="cd-num">${idx + 1}</span>
      <div class="cp-main">
        <div class="cp-name">${escapeHtml(item.productLabel)}<span class="cd-qty">${num(item.quantity)} шт.</span>${groupNum != null ? `<span class="cd-gr">Гр. ${groupNum}</span>` : ''}</div>
        ${sub ? `<div class="cp-sub">${sub}</div>` : ''}
      </div>
      <div class="cp-price"><div class="cp-pl">${rows.join('')}</div><div class="cp-fin">${rub(fin)}</div></div>
    </div>`;
}

// ── index.ts ─────────────────────────────────────────────────────────────────
// Дозаполнение полей позиций у смет, сохранённых раньше (index.ts:33-42). Возвращает новый массив.
function dozapolnitPozicii(items) {
  return items.map((item) => {
    const discountPercent = item.discountPercent ?? 0;
    // Цена за штуку (priceMode 'unit'): скидка и всё дальнейшее — от базы price × quantity (формула CRM calculateEstimateLine: round(база × (1 − %/100))). Пришедшее от CRM discountedPrice
    // не трогаем: акцию CRM считает сама и шлёт эффективные цифры. У остальных позиций поведение прежнее (golden)
    const discountedPrice = item.discountedPrice ?? (item.priceMode === 'unit' ? Math.round(itemBase(item) * (1 - discountPercent / 100)) : item.price);
    const vatEnabled = item.vatEnabled ?? false;
    const vatPercent = item.vatPercent ?? 22;
    const vatAmount = item.vatAmount ?? (vatEnabled ? Math.round(discountedPrice * vatPercent / 100) : 0);
    const finalPriceWithVat = item.finalPriceWithVat ?? (discountedPrice + vatAmount);
    return { ...item, discountPercent, discountedPrice, vatEnabled, vatPercent, vatAmount, finalPriceWithVat };
  });
}

/**
 * День печати «ГГГГ-ММ-ДД»: тот, что прислала CRM; нет его (старая вкладка) — сегодня по Москве. Одно значение для даты
 * в смете (buildHtml показывает его как «ДД.ММ.ГГГГ») и для имени файла (imyaFayla): route.js считает его один раз.
 */
function denPechati(printDay) {
  return printDay || mskDate();
}

// Имя файла: «#номер.pdf», а без номера обращения «smeta-день.pdf» (index.ts:88-94).
function imyaFayla(body) {
  const appealId = body.clientData?.appealId?.replace('#', '').trim();
  // День в имени — по Москве, как дата внутри файла; CRM сохраняет файл под своим именем,
  // но заголовок должен говорить то же самое для любого, кто зовёт службу напрямую
  const деньПечатиIso = denPechati(body.printDay);
  const filename = appealId ? `#${appealId}.pdf` : `smeta-${деньПечатиIso}.pdf`;
  return filename;
}

// ── числа тела запроса ───────────────────────────────────────────────────────
// В страницу числа идут как есть: «<h1>» в quantity попал бы туда сырой разметкой, а «abc» в price дал бы «0abc ₽» в сумме.
// Поэтому тело проходит privestiChisla: число (конечное) или строка-число — приводим Number(), всё остальное — отказ.
function chislo(znachenie) {
  if (typeof znachenie === 'number') return Number.isFinite(znachenie) ? znachenie : null;
  if (typeof znachenie === 'string' && znachenie.trim() !== '') {
    const n = Number(znachenie);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Числовые поля позиции; необязательное (null/нет) оставляем как есть: dozapolnitPozicii поставит 0
const CHISLA_POZICII = [
  { pole: 'quantity', obyazatelno: true },
  { pole: 'price', obyazatelno: true },
  { pole: 'discountPercent', obyazatelno: false },
  // Расчётные поля CRM шлёт сама; пришли — идут в страницу как есть, поэтому тоже только числами (нет — их посчитает dozapolnitPozicii)
  { pole: 'discountedPrice', obyazatelno: false },
  { pole: 'vatAmount', obyazatelno: false },
  { pole: 'finalPriceWithVat', obyazatelno: false },
  { pole: 'vatPercent', obyazatelno: false },
  // Размеры позиции (буква В): строка-число становится числом; целые 1–20000 и «оба или ни одного» проверяет route.js
  { pole: 'widthMm', obyazatelno: false },
  { pole: 'heightMm', obyazatelno: false },
];

/**
 * Приводит числа тела к числам: quantity, price, discountPercent (и необязательные расчётные поля, размеры widthMm / heightMm) каждой позиции и promoDiscount тела
 * (promoDiscount и promoFromQty могут быть null/не присланы); строковое room позиции доводит до названия помещения (nazvanieKomnaty). Позицию, которая не объект, не трогает: её отвергнет dozapolnitPozicii.
 * @param {{ items: any[], promoDiscount?: any, promoFromQty?: any }} body
 * @returns {{ items: any[], promoDiscount: number|null|undefined, promoFromQty: number|null|undefined } | null} — null, если какое-то число неверное
 */
function privestiChisla({ items, promoDiscount, promoFromQty }) {
  const privedennye = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') { privedennye.push(item); continue; }
    const kopiya = { ...item };
    for (const { pole, obyazatelno } of CHISLA_POZICII) {
      if (!obyazatelno && (item[pole] === undefined || item[pole] === null)) continue;
      const n = chislo(item[pole]);
      if (n === null) return null;
      kopiya[pole] = n;
    }
    if (typeof item.room === 'string') kopiya.room = nazvanieKomnaty(item.room); // помещение (буква В): trim, пробелы в один, не длиннее 60 знаков; строкой не являющееся route.js отвергает раньше
    privedennye.push(kopiya);
  }
  let promo = promoDiscount;
  if (promoDiscount !== undefined && promoDiscount !== null) {
    promo = chislo(promoDiscount);
    if (promo === null) return null;
  }
  let ot = promoFromQty; // «от N изделий» (буква Б): строка-число — в число, как promoDiscount; диапазон 2–20 проверяет route.js
  if (promoFromQty !== undefined && promoFromQty !== null) {
    ot = chislo(promoFromQty);
    if (ot === null) return null;
  }
  return { items: privedennye, promoDiscount: promo, promoFromQty: ot };
}

module.exports = {
  estCardCompact,
  planKompakta,
  gorodObekta,
  SITE_HOST_RE,
  VIDIMOE_RE,
  CP_A5,
  CP_PC,
  CP_PL_H,
  CP_ONE_SAFE,
  CP_TAIL_SAFE,
  CP_TAIL_SAFE_PER_CARD,
  CP_PACK_SAFE,
  estLinesM,
  SUPABASE_URL,
  buildHtml,
  dozapolnitPozicii,
  imyaFayla,
  denPechati,
  privestiChisla,
};
