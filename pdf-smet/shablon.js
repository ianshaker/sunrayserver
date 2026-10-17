/**
 * Шаблон сметы для PDF — перенос Deno-функции Supabase `generate-estimate-pdf` на наш сервер
 * (PLANS/SERVER/05-pdf-smet, буква А, 17.10.2026): `template.ts`, `styles.ts`, дозаполнение позиций
 * и имя файла из `index.ts`. Разметка и стили перенесены без изменений; `Deno.env` заменён на `process.env`.
 *
 * До снятия старой функции (буква Е) шаблонов два: правишь вид сметы здесь — правь и в
 * sunray-crm-oasis/supabase/functions/generate-estimate-pdf/ (и наоборот).
 *
 * В server.js модуль пока не подключён.
 */

// ── styles.ts ────────────────────────────────────────────────────────────────
function getStyles() {
  return `
  @page {
    size: A4;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    color: #2d2d2d;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Обложка — отлипшая, скруглённая, с тенью ── */
  .header-wrap {
    padding: 20px 24px 0;
  }
  .header-image {
    width: 100%;
    display: block;
    border-radius: 18px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
  }

  /* ── Основной контент ── */
  .content {
    padding: 28px 40px 44px;
    background: #ffffff;
  }

  /* ── Заголовок документа ── */
  .title-block {
    text-align: center;
    margin-bottom: 24px;
    padding-top: 4px;
  }
  .title-main {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #1a1a1a;
    white-space: nowrap;
  }

  /* ── Клиентская плитка (в левой колонке итогов) ── */
  .client-card {
    margin-top: 10px;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    border: 1.5px solid #d8e8e2;
  }
  .client-card-left {
    padding: 10px 14px;
    background: #fff;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #f0ece4;
  }
  .client-name {
    font-size: 12px;
    font-weight: 700;
    color: #1e5a46;
    line-height: 1.3;
  }
  .client-appeal-id {
    font-size: 10px;
    font-weight: 700;
    color: #e07b30;
    letter-spacing: 0.04em;
  }
  .client-card-right {
    padding: 10px 14px;
    background: #fff;
  }
  .client-detail {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 10.5px;
    padding: 2px 0;
  }
  .client-detail-label {
    font-weight: 700;
    color: #1e5a46;
    min-width: 48px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .client-detail-value {
    color: #2d2d2d;
  }

  /* ── Таблица ── */
  .table-wrapper {
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 6px 28px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.05);
    margin-bottom: 0;
    background: #fff;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    background: #fff;
  }

  thead { display: table-header-group; }
  thead tr {
    background: linear-gradient(135deg, #1a4a38 0%, #1e5a46 60%, #2a7a5e 100%);
  }
  thead th {
    color: #fff;
    font-weight: 600;
    font-size: 9.5px;
    padding: 13px 10px;
    text-align: left;
    border: none;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  thead th:first-child { border-radius: 16px 0 0 0; }
  thead th:last-child  { border-radius: 0 16px 0 0; }

  tbody tr { page-break-inside: avoid; }
  tbody tr:last-child td { border-bottom: none; }

  tbody td {
    padding: 11px 10px;
    border-bottom: 1px solid #edf2f0;
    vertical-align: middle;
    color: #2d2d2d;
  }

  .col-num  { text-align: center; width: 32px; font-weight: 500; color: #2d2d2d; }
  .col-product { width: 24%; font-weight: 500; }
  .col-material { width: auto; }
  .col-qty  { text-align: center; width: 36px; white-space: nowrap; }
  .col-price { text-align: right; width: 72px; white-space: nowrap; }
  .col-discount { text-align: center; width: 52px; white-space: nowrap; }
  tbody .col-discount { color: #e07b30; font-weight: 600; }
  .col-after-discount { text-align: right; width: 60px; white-space: nowrap; }
  .col-vat  { text-align: center; width: 70px; white-space: nowrap; }
  tbody .col-vat { color: #1e5a46; font-weight: 600; font-size: 10px; }
  .col-vat .vat-amount { font-weight: 400; font-size: 9px; color: #4aaa80; display: block; }
  .col-final { text-align: right; width: 90px; font-weight: 700; white-space: nowrap; color: #1a4a38; }

  /* все заголовки белые — перебиваем цвета колонок для thead */
  thead th { color: #fff !important; }

  .f-value-range { font-size: 11px; color: #6d28d9; font-weight: 700; }

  /* ── Промо-баннер ── */
  .promo-banner {
    margin: 14px 0 0;
    padding: 10px 18px;
    background: linear-gradient(90deg, #fff7ed 0%, #fef3c7 100%);
    border-left: 4px solid #f59e0b;
    border-radius: 8px;
    font-size: 11.5px;
    font-weight: 600;
    color: #92400e;
    letter-spacing: 0.01em;
  }

  .vat-included-banner {
    margin: 10px 0 0;
    padding: 10px 18px;
    background: linear-gradient(90deg, #eff6ff 0%, #e0f2fe 100%);
    border-left: 4px solid #0ea5e9;
    border-radius: 8px;
    font-size: 11.5px;
    font-weight: 600;
    color: #0c4a6e;
    letter-spacing: 0.01em;
  }

  /* ── Блок итогов — двухколоночный ── */
  .totals-section {
    margin-top: 20px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .totals-left {
    flex: 1;
    min-width: 0;
  }
  .totals-note {
    font-size: 10px;
    color: #aaa;
    line-height: 1.7;
    padding: 14px 16px;
    background: #fff;
    border-radius: 12px;
    border: 1px dashed #ddd;
  }
  .validity-main {
    font-size: 11px;
    color: #777;
    line-height: 1.5;
  }
  .validity-main b {
    font-size: 13px;
    font-weight: 700;
    color: #1a4a38;
    white-space: nowrap;
  }
  .validity-sub {
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid #f0f0f0;
    font-size: 9px;
    color: #bbb;
  }

  .totals-right {
    flex: 0 0 280px;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    border: 1.5px solid #d8e8e2;
  }
  .totals-header {
    background: linear-gradient(135deg, #1a4a38 0%, #1e5a46 100%);
    padding: 10px 18px;
  }
  .totals-header-text {
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.85);
  }
  .totals-body {
    padding: 12px 18px;
  }
  .totals-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 0;
    font-size: 11.5px;
    color: #555;
    border-bottom: 1px solid #f0ece4;
  }
  .totals-row:last-of-type { border-bottom: none; }
  .totals-row .t-label { font-weight: 400; }
  .totals-row .t-value { font-weight: 600; color: #2d2d2d; }
  .totals-row.discount-row .t-label,
  .totals-row.discount-row .t-value { color: #e07b30; }
  .totals-row.vat-row .t-label,
  .totals-row.vat-row .t-value { color: #1e5a46; }
  .totals-row.montage-row .t-label,
  .totals-row.montage-row .t-value { color: #1e5a46; }
  .totals-divider {
    height: 1.5px;
    background: linear-gradient(90deg, transparent, #1e5a46, transparent);
    margin: 8px 0;
  }
  .totals-final {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0 4px;
  }
  .totals-final .f-label {
    font-size: 12px;
    font-weight: 600;
    color: #1a4a38;
    letter-spacing: 0.02em;
  }
  .totals-final .f-value {
    font-size: 18px;
    font-weight: 700;
    color: #1a4a38;
    letter-spacing: -0.01em;
  }

  /* ── Компания ── */
  .company-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 24px;
    padding: 18px 22px;
    background: #fff;
    border-radius: 14px;
    border: 1.5px solid #e8e8e8;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .company-info {
    font-size: 10px;
    line-height: 1.9;
    color: #3a3a3a;
  }
  .company-info a {
    color: #1e5a46;
    text-decoration: none;
  }
  .company-stamp img {
    width: 130px;
    height: auto;
    display: block;
  }
`;
}

// ── template.ts ──────────────────────────────────────────────────────────────
// Хвостовой «/» отрезаем: на Render адрес могут записать с ним, и в пути обложки и печати вышло бы «//» (дыра 11).
// «||», а не «??»: пустая переменная тоже даёт запасной адрес (как lib/supabaseClient.js).
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://xyzkneqhggpxstxqbqhs.supabase.co').replace(/\/+$/, '');
const storagePublic = (path) => `${SUPABASE_URL}/storage/v1/object/public/${path}`;

function buildHtml(data) {
  const {
    clientData, items, headerImageUrl, promoDiscount = null, vatIncluded5 = false,
    groups = [], montage = null, validUntil = null, createdDay = null, printDay = null,
  } = data;

  // Дни приходят готовыми строками «2026-09-29»: их считает CRM по Москве. Свои часы
  // у службы печати живут по UTC и ночью поставили бы в файл вчерашнее число.
  //
  // Зеркало правил CRM — Deno-функция не видит исходников, поэтому копия. Правишь там — правь здесь:
  // днём ↔ formatDay, разницаДней ↔ daysBetween, запасной деньПечатиIso ↔ moscowDay — src/lib/moscowDate.ts
  // (в CRM день считает date-fns-tz, здесь Intl — у Deno-функции нет этой библиотеки);
  // словоДней ↔ склонить — src/utils/formatters.ts (в CRM его зовёт daysWord);
  // дни от дня составления ↔ daysFromValidUntil, прежний текст про 14 дней ↔ LEGACY_PDF_VALIDITY_DAYS —
  // src/components/department/calculations/estimate/validity.ts
  const днём = (day) => day.split('-').reverse().join('.');
  // Запасной путь для старых вкладок CRM, которые не шлют день: считаем его по Москве сами
  const деньПечатиIso = printDay || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const деньПечати = днём(деньПечатиIso);
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
  const validityNote = validUntil
    ? `<div class="validity-main">Предложение действительно${сколькоДействует ? ` ${сколькоДействует}` : ''}<br><b>до ${днём(validUntil)}</b></div>
          <div class="validity-sub">Смета составлена ${днём(деньСоставления)}</div>`
    : `Настоящее коммерческое предложение<br>
          действительно в течение 14 дней<br>
          с момента формирования.<br>
          <span style="margin-top:6px;display:inline-block;">Дата: <strong>${деньПечати}</strong></span>`;

  // Зеркало montage.ts из CRM: к итогу прибавляется только своя сумма и только
  // больше нуля, «включён» и «бесплатно» показываются словами и итог не двигают
  const montageAmount = montage && montage.mode === 'sum' && Number.isFinite(Number(montage.amount))
    ? Math.max(0, Math.round(Number(montage.amount)))
    : 0;
  const montageLine = !montage || montage.mode === 'none'
    ? null
    : montage.mode === 'included'
      ? 'включён в стоимость'
      : montage.mode === 'free'
        ? 'бесплатно'
        : `${montageAmount.toLocaleString('ru-RU')} ₽`;
  const defaultHeaderUrl = storagePublic('estimate_products/MAIN-pics/oblojkafull.jpg');
  const imgUrl = headerImageUrl || defaultHeaderUrl;

  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalBasePrice = items.reduce((sum, item) => sum + item.price, 0);
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
  const basePriceNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + i.price, 0);
  const baseAfterDiscountNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + i.discountedPrice, 0);
  const baseDiscNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + (i.price - i.discountedPrice), 0);
  const baseVatNoGroup = items.filter(i => !i.groupId).reduce((s, i) => s + (i.vatAmount ?? 0), 0);

  let groupPriceMin = 0, groupPriceMax = 0;
  let groupAfterDiscountMin = 0, groupAfterDiscountMax = 0;
  let groupDiscMin = 0, groupDiscMax = 0;
  let groupVatMin = 0, groupVatMax = 0;
  if (hasGroups) {
    groups.forEach(g => {
      const gItems = items.filter(i => i.groupId === g.id);
      if (gItems.length === 0) return;
      groupPriceMin         += Math.min(...gItems.map(i => i.price));
      groupPriceMax         += Math.max(...gItems.map(i => i.price));
      groupAfterDiscountMin += Math.min(...gItems.map(i => i.discountedPrice));
      groupAfterDiscountMax += Math.max(...gItems.map(i => i.discountedPrice));
      // скидка = price - discountedPrice у каждого item, не разница вариантов
      groupDiscMin          += Math.min(...gItems.map(i => i.price - i.discountedPrice));
      groupDiscMax          += Math.max(...gItems.map(i => i.price - i.discountedPrice));
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

  // Цвета групп для PDF (фон строки и цвет метки)
  const GROUP_COLORS_PDF = [
    { bg: '#eff6ff', label: '#1d4ed8' },  // синий
    { bg: '#f5f3ff', label: '#6d28d9' },  // фиолетовый
    { bg: '#fff7ed', label: '#c2410c' },  // оранжевый
    { bg: '#fdf2f8', label: '#9d174d' },  // розовый
    { bg: '#f0fdf4', label: '#166534' },  // зелёный
  ];

  // Строим строки таблицы — цветной фон и метка группы
  const tableRows = items.map((item, idx) => {
    const groupIdx = item.groupId ? groups.findIndex(g => g.id === item.groupId) : -1;
    const groupColor = groupIdx >= 0 ? GROUP_COLORS_PDF[groupIdx % GROUP_COLORS_PDF.length] : null;
    const groupNum = groupIdx >= 0 ? groupIdx + 1 : null;
    const rowBg = groupColor ? `background:${groupColor.bg};` : (idx % 2 === 0 ? '' : 'background:#f9f9f7;');
    const groupLabel = groupNum
      ? `<span style="font-size:8px;font-weight:700;color:${groupColor.label};background:${groupColor.bg};border:1px solid ${groupColor.label}33;border-radius:4px;padding:1px 5px;margin-right:4px;white-space:nowrap;">Гр. ${groupNum}</span>`
      : '';
    return `
    <tr style="${rowBg}">
      <td class="col-num">${idx + 1}</td>
      <td class="col-product">${groupLabel}${escapeHtml(item.productLabel)}</td>
      <td class="col-material">${escapeHtml(item.materialName)}</td>
      <td class="col-qty">${item.quantity}</td>
      <td class="col-price">${item.price.toLocaleString('ru-RU')} ₽</td>
      ${hasAnyDiscount ? `<td class="col-discount">${item.discountPercent > 0 ? item.discountPercent + '%' : '—'}</td><td class="col-after-discount">${item.discountedPrice.toLocaleString('ru-RU')} ₽</td>` : ''}
      ${hasAnyVat ? `<td class="col-vat">${item.vatEnabled
        ? `22%<span class="vat-amount">${(item.vatAmount ?? 0).toLocaleString('ru-RU')} ₽</span>`
        : '—'}</td>` : ''}
      <td class="col-final">${(item.finalPriceWithVat ?? item.discountedPrice).toLocaleString('ru-RU')} ₽</td>
    </tr>
  `;
  }).join('');

  const clientBlock = clientData ? `
    <div class="client-card">
      <div class="client-card-left">
        <div class="client-name">${escapeHtml(clientData.clientName || '—')}</div>
        ${clientData.appealId ? `<div class="client-appeal-id">${escapeHtml(clientData.appealId)}</div>` : ''}
      </div>
      <div class="client-card-right">
        <div class="client-detail">
          <span class="client-detail-label">Телефон</span>
          <span class="client-detail-value">${escapeHtml(clientData.phone || '—')}</span>
        </div>
        <div class="client-detail">
          <span class="client-detail-label">Город</span>
          <span class="client-detail-value">${escapeHtml(clientData.city || '—')}</span>
        </div>
        ${clientData.address ? `
        <div class="client-detail">
          <span class="client-detail-label">Адрес</span>
          <span class="client-detail-value">${escapeHtml(clientData.address)}</span>
        </div>` : ''}
      </div>
    </div>
  ` : '';

  const promoBlock = promoDiscount ? `
    <div class="promo-banner">
      При заказе от 2 изделий действует скидка на весь заказ в размере ${promoDiscount}%
    </div>
  ` : '';

  const vatIncludedBlock = vatIncluded5 ? `
    <div class="vat-included-banner">
      Указанные цены уже включают НДС 5% (налог включён в стоимость).
    </div>
  ` : '';

  const fmtRange = (min, max) =>
    min === max
      ? `${min.toLocaleString('ru-RU')} ₽`
      : `от ${min.toLocaleString('ru-RU')} до ${max.toLocaleString('ru-RU')} ₽`;

  const totalsRows = `
    <div class="totals-row">
      <span class="t-label">Количество позиций</span>
      <span class="t-value">${displayQtyStr} шт.</span>
    </div>
    ${hasAnyDiscount ? `
    <div class="totals-row">
      <span class="t-label">Сумма без скидки</span>
      <span class="t-value">${hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : totalBasePrice.toLocaleString('ru-RU') + ' ₽'}</span>
    </div>
    <div class="totals-row discount-row">
      <span class="t-label">Скидка</span>
      <span class="t-value">${hasGroups ? '−' + fmtRange(displayDiscMin, displayDiscMax) : '−' + totalDiscountAmount.toLocaleString('ru-RU') + ' ₽'}</span>
    </div>
    <div class="totals-row">
      <span class="t-label">После скидки</span>
      <span class="t-value">${hasGroups ? fmtRange(displayAfterDiscMin, displayAfterDiscMax) : totalAfterDiscount.toLocaleString('ru-RU') + ' ₽'}</span>
    </div>
    ` : `
    <div class="totals-row">
      <span class="t-label">Сумма</span>
      <span class="t-value">${hasGroups ? fmtRange(displayPriceMin, displayPriceMax) : totalBasePrice.toLocaleString('ru-RU') + ' ₽'}</span>
    </div>
    `}
    ${hasAnyVat ? `
    <div class="totals-row vat-row">
      <span class="t-label">НДС 22%</span>
      <span class="t-value">${hasGroups ? '+' + fmtRange(displayVatMin, displayVatMax) : '+' + totalVatAmount.toLocaleString('ru-RU') + ' ₽'}</span>
    </div>
    ` : ''}
    ${montageLine ? `
    <div class="totals-row montage-row">
      <span class="t-label">Монтаж</span>
      <span class="t-value">${montageLine}</span>
    </div>
    ` : ''}
  `;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
${getStyles()}
</style>
</head>
<body>
  <div class="header-wrap">
    <img src="${imgUrl}" class="header-image" />
  </div>
  <div class="content">

    <div class="title-block">
      <div class="title-main">Коммерческое предложение</div>
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="col-num">№</th>
            <th class="col-product">Тип продукта</th>
            <th class="col-material">Материал</th>
            <th class="col-qty">К-ВО</th>
            <th class="col-price">ЦЕНА</th>
            ${hasAnyDiscount ? `<th class="col-discount">Скидка</th><th class="col-after-discount">% → ₽</th>` : ''}
            ${hasAnyVat ? `<th class="col-vat">НДС</th>` : ''}
            <th class="col-final">${hasAnyVat ? 'ИТОГО с НДС' : 'ИТОГО'}</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    ${promoBlock}
    ${vatIncludedBlock}

    <div class="totals-section">
      <div class="totals-left">
        <div class="totals-note">
          ${validityNote}
        </div>
        ${clientBlock}
      </div>
      <div class="totals-right">
        <div class="totals-header">
          <div class="totals-header-text">Расчёт стоимости</div>
        </div>
        <div class="totals-body">
          ${totalsRows}
          <div class="totals-divider"></div>
          <div class="totals-final">
            <span class="f-label">Итого к оплате</span>
            ${hasGroups
              ? `<span class="f-value f-value-range">от ${finalMin.toLocaleString('ru-RU')} до ${finalMax.toLocaleString('ru-RU')} ₽</span>`
              : `<span class="f-value">${(totalFinalItems + montageAmount).toLocaleString('ru-RU')} ₽</span>`}
          </div>
        </div>
      </div>
    </div>

    <div class="company-section">
      <div class="company-info">
        Индивидуальный предприниматель Журович-Миронова Дарья Васильевна<br>
        ИНН 910502074977 · ОГРНИП 321911200058121<br>
        Тел. +7(999) 810-77-17 · sunray-zhalyuzi@yandex.ru<br>
        <a href="https://zhalyuzi-sunray.ru/">zhalyuzi-sunray.ru</a>
      </div>
      <div class="company-stamp">
        <img src="${storagePublic('estimate_products/MAIN-pics/stamp.webp')}" />
      </div>
    </div>

  </div>
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

// ── index.ts ─────────────────────────────────────────────────────────────────
// Дозаполнение полей позиций у смет, сохранённых раньше (index.ts:33-42). Возвращает новый массив.
function dozapolnitPozicii(items) {
  return items.map((item) => {
    const discountPercent = item.discountPercent ?? 0;
    const discountedPrice = item.discountedPrice ?? item.price;
    const vatEnabled = item.vatEnabled ?? false;
    const vatPercent = item.vatPercent ?? 22;
    const vatAmount = item.vatAmount ?? (vatEnabled ? Math.round(discountedPrice * vatPercent / 100) : 0);
    const finalPriceWithVat = item.finalPriceWithVat ?? (discountedPrice + vatAmount);
    return { ...item, discountPercent, discountedPrice, vatEnabled, vatPercent, vatAmount, finalPriceWithVat };
  });
}

// Имя файла: «#номер.pdf», а без номера обращения «smeta-день.pdf» (index.ts:88-94).
function imyaFayla(body) {
  const appealId = body.clientData?.appealId?.replace('#', '').trim();
  // День в имени — по Москве, как дата внутри файла; CRM сохраняет файл под своим именем,
  // но заголовок должен говорить то же самое для любого, кто зовёт службу напрямую
  const деньПечати = body.printDay || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const filename = appealId ? `#${appealId}.pdf` : `smeta-${деньПечати}.pdf`;
  return filename;
}

module.exports = {
  SUPABASE_URL,
  storagePublic,
  getStyles,
  buildHtml,
  escapeHtml,
  dozapolnitPozicii,
  imyaFayla,
};
