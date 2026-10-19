"use strict";

// Шаблон сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква Б; вид A5 — 19.10.2026): имя файла, день печати по Москве, числа тела, срок КП (обе формы),
// экранирование (в том числе «</style>» в номере обращения: подвал листа — CSS-строка в @page) и смысл разметки: позиции и суммы, скидка,
// НДС 22 %, группы «Гр. N», диапазон «от … до …», монтаж, плашки акции и НДС 5 %, правила листов, последний лист без подвала, нижняя плитка.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/shablon.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHtml, dozapolnitPozicii, imyaFayla, denPechati, privestiChisla, SUPABASE_URL } = require("./shablon");

const OBLOZHKA = `${SUPABASE_URL}/storage/v1/object/public/estimate_products/MAIN-pics/oblojkafull.jpg`;
const POZICIYA = {
  id: "p1",
  productType: "roller_mini",
  productLabel: "Рулонная штора MINI",
  materialName: "Ткань",
  quantity: 2,
  price: 10000,
};

// Тело запроса как у CRM; dop переопределяет поля. Возвращает готовый HTML.
function smeta(dop = {}) {
  const body = {
    clientData: { appealId: "#09784", clientName: "Тест Тестов", phone: "8(900)000-00-00", city: "Химки", address: "" },
    items: [POZICIYA],
    headerImageUrl: OBLOZHKA,
    promoDiscount: null,
    vatIncluded5: false,
    groups: [],
    validUntil: null,
    createdDay: "2026-09-12",
    printDay: "2026-10-17",
    ...dop,
  };
  return buildHtml({ ...body, items: dozapolnitPozicii(body.items) });
}

// --- помощники для проверок смысла: разметка вида — карточки .cd, расчёт .totals-*, итог .tb-*, срок КП .tb-note ---
const NB = " "; // toLocaleString('ru-RU') делит тысячи неразрывным пробелом: 12500 → «12 500»
const MINUS = "−"; // знак скидки в смете — настоящий минус, а не дефис
const BEZ_STILEI = (html) => html.replace(/<style>[\s\S]*?<\/style>/, "");
// Текст страницы: значки-SVG выброшены, теги — пробелы, пробелы сжаты (неразрывный остаётся)
const tekst = (html) => BEZ_STILEI(html).replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
// Значение строки «Расчёта стоимости» по подписи («Сумма», «Скидка», «НДС 22%», «Монтаж»…); такой строки нет — null
function stroka(html, podpis) {
  const m = BEZ_STILEI(html).match(new RegExp(`<span class="t-label">${podpis}</span>\\s*<span class="t-value">([\\s\\S]*?)</span>\\s*</div>`));
  return m ? tekst(m[1]) : null;
}
// «Итого к оплате» текстом: «15 500 ₽» или «от 14 000 до 17 600 ₽»
function itogo(html) {
  const m = BEZ_STILEI(html).match(/<span class="tb-label">Итого к оплате<\/span>\s*<span class="tb-amount(?: tb-long)?">([\s\S]*?)<\/span>\s*<\/div>/);
  return m ? tekst(m[1]) : null;
}
// Разметка карточек позиций по порядку: кусок страницы от начала карточки до начала следующей (у последней — до конца страницы)
function kartochki(html) {
  return BEZ_STILEI(html).split(/(?=<div class="cd(?: cd-g)?")/).slice(1);
}

test("имя файла: «#номер.pdf», а без номера обращения «smeta-день.pdf»", () => {
  assert.equal(imyaFayla({ clientData: { appealId: "#09784" } }), "#09784.pdf");
  assert.equal(imyaFayla({ clientData: { appealId: " #123 " } }), "#123.pdf");
  assert.equal(imyaFayla({ clientData: { clientName: "без номера" }, printDay: "2026-10-17" }), "smeta-2026-10-17.pdf");
  assert.equal(imyaFayla({ clientData: null, printDay: "2026-10-17" }), "smeta-2026-10-17.pdf");
});

test("имя файла без printDay: день по Москве, а не по UTC", (t) => {
  // 22:30 UTC 16 октября — в Москве уже 01:30 17 октября
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-16T22:30:00Z") });
  assert.equal(imyaFayla({ clientData: null }), "smeta-2026-10-17.pdf");
});

test("день печати без printDay: и в смете, и в имени файла — по Москве (22:30 UTC 17.10 — уже 18.10), а присланный день не трогаем", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-17T22:30:00Z") });
  assert.equal(denPechati(undefined), "2026-10-18");
  assert.equal(denPechati(""), "2026-10-18");
  assert.equal(denPechati("2026-09-01"), "2026-09-01");
  assert.equal(imyaFayla({ clientData: null }), "smeta-2026-10-18.pdf");
  assert.match(smeta({ validUntil: null, printDay: null }), /Дата: <b>18\.10\.2026<\/b>/);
  // Присланный CRM день остаётся как есть и в смете, и в имени
  assert.match(smeta({ validUntil: null, printDay: "2026-10-17" }), /Дата: <b>17\.10\.2026<\/b>/);
  assert.equal(imyaFayla({ clientData: null, printDay: "2026-10-17" }), "smeta-2026-10-17.pdf");
});

test("privestiChisla: строка-число — в число, неверное — null, позиция не объект не трогается, вход не меняется", () => {
  const vhod = { items: [{ ...POZICIYA, quantity: "2", price: "10000.5", discountPercent: " 5 " }], promoDiscount: "25" };
  const kopiya = JSON.parse(JSON.stringify(vhod));
  const ok = privestiChisla(vhod);
  assert.equal(ok.items[0].quantity, 2);
  assert.equal(ok.items[0].price, 10000.5);
  assert.equal(ok.items[0].discountPercent, 5);
  assert.equal(ok.items[0].productLabel, POZICIYA.productLabel);
  assert.equal(ok.promoDiscount, 25);
  assert.deepEqual(vhod, kopiya);
  assert.equal(privestiChisla({ items: [POZICIYA], promoDiscount: null }).promoDiscount, null);
  assert.equal(privestiChisla({ items: [POZICIYA] }).promoDiscount, undefined);
  assert.equal(privestiChisla({ items: [{ ...POZICIYA, discountPercent: undefined }] }).items[0].discountPercent, undefined);
  for (const plohoe of ["<h1>", "abc", "", "  ", "0abc", NaN, Infinity, true, [], {}, null, undefined]) {
    assert.equal(privestiChisla({ items: [{ ...POZICIYA, price: plohoe }] }), null, String(plohoe));
  }
  assert.equal(privestiChisla({ items: [{ ...POZICIYA, quantity: "x" }] }), null);
  assert.equal(privestiChisla({ items: [POZICIYA], promoDiscount: "x" }), null);
  assert.deepEqual(privestiChisla({ items: [null, "строка"] }).items, [null, "строка"]);
});

test("срок КП, обе формы дословно: со сроком «до» и день составления, без срока — фраза про 14 дней; текст стоит над нижней плиткой, а не в ней", () => {
  const sSrokom = smeta({ validUntil: "2026-10-22", createdDay: "2026-10-08" });
  assert.ok(sSrokom.includes('<div class="tb-vlab">Срок предложения</div><div class="tb-vmain">Предложение действительно 14 дней — до <b>22.10.2026</b></div><div class="tb-vsub">Смета составлена 08.10.2026</div>'));
  assert.doesNotMatch(BEZ_STILEI(sSrokom), /действительно в течение 14 дней/);

  const bezSroka = smeta({ validUntil: null, printDay: "2026-10-17" });
  assert.ok(bezSroka.includes('<div class="tb-vlab">Срок предложения</div><div class="tb-vmain">Настоящее коммерческое предложение действительно в течение 14 дней с момента формирования. Дата: <b>17.10.2026</b></div>'));
  assert.doesNotMatch(BEZ_STILEI(bezSroka), /class="tb-vsub"|Смета составлена/);

  // Обычный текст на белом поле: в связке .tail он идёт раньше плитки «Итого к оплате», а в самой плитке его нет
  for (const html of [sSrokom, bezSroka]) {
    const razmetka = BEZ_STILEI(html);
    const tail = razmetka.indexOf('<div class="tail">');
    const zapiska = razmetka.indexOf('<div class="tb-note');
    const plitka = razmetka.indexOf('<div class="tb">');
    assert.ok(tail >= 0 && tail < zapiska && zapiska < plitka, "срок КП должен стоять в связке .tail перед нижней плиткой");
    assert.ok(!razmetka.slice(plitka).includes("Срок предложения"), "срок КП оказался внутри плитки");
  }
});

test("срок КП: число дней считается от дня составления и склоняется (1 день, 2 дня, 5 дней, 11 дней, 21 день); не позже дня составления — без числа", () => {
  for (const [do_, slova] of [["2026-10-09", "1 день"], ["2026-10-10", "2 дня"], ["2026-10-13", "5 дней"], ["2026-10-19", "11 дней"], ["2026-10-29", "21 день"]]) {
    const html = smeta({ validUntil: do_, createdDay: "2026-10-08" });
    assert.ok(html.includes(`<div class="tb-vmain">Предложение действительно ${slova} — до <b>`), slova);
  }
  const bezChisla = smeta({ validUntil: "2026-10-08", createdDay: "2026-10-08" });
  assert.ok(bezChisla.includes('<div class="tb-vmain">Предложение действительно до <b>08.10.2026</b></div>'));
});

test("настоящие даты экранирование не меняет", () => {
  const html = smeta({ validUntil: "2026-10-22", createdDay: "2026-10-08" });
  assert.ok(html.includes("до <b>22.10.2026</b>"));
  assert.ok(html.includes(`<div class="pl-dt">от${NB}08.10.2026</div>`)); // день составления на плитке
});

test("headerImageUrl шаблон не читает: адрес, кавычка и теги из него в страницу не попадают (фото-обложки нет)", () => {
  for (const headerImageUrl of [OBLOZHKA, 'https://evil.example/a.png" onerror="alert(1)', 'x"><script>alert(1)</script>']) {
    const html = smeta({ headerImageUrl });
    assert.ok(!html.includes("header-image"), "тег обложки остался");
    assert.ok(!html.includes("evil.example"));
    assert.ok(!html.includes("onerror"));
    assert.ok(!/<script/i.test(html));
    assert.ok(!html.includes("oblojkafull"));
  }
});

test("даты экранируются: validUntil, createdDay и printDay не вставляют разметку", () => {
  const sSrokom = smeta({ validUntil: "2026-10-22<b>x</b>", createdDay: '"><i>1</i>' });
  assert.ok(!sSrokom.includes("<b>x</b>"));
  assert.ok(!sSrokom.includes("<i>1</i>"));
  assert.ok(sSrokom.includes("22&lt;b&gt;x&lt;/b&gt;.10.2026"));
  assert.ok(sSrokom.includes("&quot;&gt;&lt;i&gt;1&lt;/i&gt;"));

  const bezSroka = smeta({ validUntil: null, printDay: "<u>1</u>" });
  assert.ok(!bezSroka.includes("<u>1</u>"));
  assert.ok(bezSroka.includes("Дата: <b>&lt;u&gt;1&lt;/u&gt;</b>"));
});

// --- смысл разметки нового вида: позиции, суммы, скидка, НДС, группы, диапазоны, монтаж, плашки ---

const DRUGAYA = { id: "p2", productType: "horizontal", productLabel: "Жалюзи горизонтальные", materialName: "Алюминий", quantity: 1, price: 5500 };
// Диапазон: одна позиция вне групп и два варианта группы (разная цена, количество и скидка)
const DIAPAZON = {
  groups: [{ id: "g1", name: "Ткань" }],
  items: [
    { ...POZICIYA, id: "a", quantity: 1, price: 5000 },
    { ...POZICIYA, id: "b", groupId: "g1", quantity: 1, price: 10000, discountPercent: 10, discountedPrice: 9000 },
    { ...POZICIYA, id: "c", groupId: "g1", quantity: 3, price: 14000, discountPercent: 10, discountedPrice: 12600 },
  ],
};

test("позиции и суммы: карточка на каждую позицию (номер, название, материал, «N шт.», итог), расчёт и «Итого к оплате» сходятся", () => {
  const html = smeta({ items: [POZICIYA, DRUGAYA] });
  const k = kartochki(html);
  assert.equal(k.length, 2);
  assert.match(k[0], /<span class="cd-num">1<\/span>/);
  assert.match(k[0], /<div class="cd-name">Рулонная штора MINI<\/div>/);
  assert.match(k[0], /<div class="cd-mat">Ткань<\/div>/);
  assert.ok(k[0].includes(`<span class="cd-qty">2${NB}шт.</span>`)); // «2» и «шт.» — через неразрывный пробел
  assert.ok(k[0].includes(`<div class="cd-fin">10${NB}000 ₽</div>`));
  assert.match(k[1], /<span class="cd-num">2<\/span>/);
  assert.match(k[1], /<div class="cd-name">Жалюзи горизонтальные<\/div>/);
  assert.ok(k[1].includes(`<div class="cd-fin">5${NB}500 ₽</div>`));
  // Цена — за позицию целиком, на количество не умножается: 10 000 + 5 500
  assert.equal(stroka(html, "Количество позиций"), "3 шт.");
  assert.equal(stroka(html, "Сумма"), `15${NB}500 ₽`);
  assert.equal(itogo(html), `15${NB}500 ₽`);
  for (const net of ["Скидка", "Сумма без скидки", "После скидки", "НДС 22%", "Монтаж"]) assert.equal(stroka(html, net), null, net);
  assert.ok(!/blk-promo|blk-vat5/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), "плашек акции и НДС 5% без причины нет");
});

test("скидка: старая цена зачёркнута, чип «−N%», цена со скидкой — итогом карточки; в расчёте «Сумма без скидки», «Скидка», «После скидки»", () => {
  const html = smeta({ items: [{ ...POZICIYA, discountPercent: 10, discountedPrice: 9000 }, DRUGAYA] });
  const k = kartochki(html);
  assert.ok(k[0].includes(`<s class="cd-old">10${NB}000 ₽</s><span class="cd-off">${MINUS}10%</span>`));
  assert.ok(k[0].includes(`<div class="cd-fin">9${NB}000 ₽</div>`));
  assert.doesNotMatch(k[1], /cd-old|cd-off/); // у позиции без скидки ни старой цены, ни чипа
  assert.equal(stroka(html, "Сумма без скидки"), `15${NB}500 ₽`);
  assert.equal(stroka(html, "Скидка"), `${MINUS}1${NB}000 ₽`);
  assert.equal(stroka(html, "После скидки"), `14${NB}500 ₽`);
  assert.equal(stroka(html, "Сумма"), null);
  assert.equal(itogo(html), `14${NB}500 ₽`);
});

test("НДС 22%: в карточке «Цена … + НДС 22% · сумма», в расчёте «НДС 22%» и итог с налогом; скидка вместе с НДС — цена со скидкой и НДС от неё", () => {
  const html = smeta({ items: [{ ...POZICIYA, vatEnabled: true }] });
  const [k] = kartochki(html);
  assert.ok(k.includes(`<div class="cd-pre">Цена 10${NB}000 ₽</div>`));
  assert.ok(k.includes(`<div class="cd-vat">+ НДС 22% · 2${NB}200 ₽</div>`));
  assert.ok(k.includes(`<div class="cd-fin">12${NB}200 ₽</div>`));
  assert.equal(stroka(html, "НДС 22%"), `+2${NB}200 ₽`);
  assert.equal(itogo(html), `12${NB}200 ₽`);

  const soSkidkoj = smeta({ items: [{ ...POZICIYA, vatEnabled: true, discountPercent: 10, discountedPrice: 9000 }] });
  const [d] = kartochki(soSkidkoj);
  assert.ok(d.includes(`<s class="cd-old">10${NB}000 ₽</s><span class="cd-off">${MINUS}10%</span>`));
  assert.ok(d.includes(`<div class="cd-r2">9${NB}000 ₽</div>`));
  assert.ok(d.includes(`<div class="cd-vat">+ НДС 22% · 1${NB}980 ₽</div>`));
  assert.ok(d.includes(`<div class="cd-fin">10${NB}980 ₽</div>`));
  assert.equal(stroka(soSkidkoj, "НДС 22%"), `+1${NB}980 ₽`);
  assert.equal(itogo(soSkidkoj), `10${NB}980 ₽`);
});

test("группа вариантов: «Гр. N» по порядку групп только у позиций группы; позиция вне групп — без метки и без цвета группы", () => {
  const html = smeta({
    groups: [{ id: "g1", name: "Ткань" }, { id: "g2", name: "Цвет" }],
    items: [
      { ...POZICIYA, id: "a" },
      { ...POZICIYA, id: "b", productLabel: "Вариант А", groupId: "g1", price: 8000 },
      { ...POZICIYA, id: "c", productLabel: "Вариант Б", groupId: "g1", price: 12000 },
      { ...POZICIYA, id: "d", productLabel: "Другая группа", groupId: "g2", price: 3000 },
    ],
  });
  const k = kartochki(html);
  assert.equal(k.length, 4);
  assert.doesNotMatch(k[0], /cd-gr|cd cd-g/);
  assert.ok(k[1].includes(`<span class="cd-gr">Гр.${NB}1</span>`));
  assert.ok(k[2].includes(`<span class="cd-gr">Гр.${NB}1</span>`));
  assert.ok(k[3].includes(`<span class="cd-gr">Гр.${NB}2</span>`));
  assert.match(k[1], /^<div class="cd cd-g" style="--cd-main:#0f766e;--cd-bg:#f0faf8;--cd-line:#[0-9a-f]{6};--cd-bg2:#[0-9a-f]{6};--cd-lo:#[0-9a-f]{6}">/); // тил — первая группа
  assert.match(k[3], /^<div class="cd cd-g" style="--cd-main:#7a3b69;/); // слива — вторая
  assert.match(k[0], /^<div class="cd">/); // позиция вне групп — обычная карточка
});

test("диапазон: варианты группы с разной ценой дают «от … до …» в количестве, сумме, скидке (знак у каждого числа), после скидки и в итоге", () => {
  const html = smeta(DIAPAZON);
  assert.equal(stroka(html, "Количество позиций"), "от 2 до 4 шт.");
  assert.equal(stroka(html, "Сумма без скидки"), `от 15${NB}000 до 19${NB}000 ₽`);
  assert.equal(stroka(html, "Скидка"), `от ${MINUS}1${NB}000 до ${MINUS}1${NB}400 ₽`);
  assert.equal(stroka(html, "После скидки"), `от 14${NB}000 до 17${NB}600 ₽`);
  assert.equal(itogo(html), `от 14${NB}000 до 17${NB}600 ₽`);
  // Итого — одной строкой с крупными числами: «от» и «до» мелко, сами суммы в <b>
  assert.ok(html.includes(`<span class="tb-w">от</span> <b>14${NB}000</b> <span class="tb-w">до</span> <b>17${NB}600</b> <span class="tb-w">₽</span>`));
  // Монтаж суммой прибавляется к обоим концам диапазона
  assert.equal(itogo(smeta({ ...DIAPAZON, montage: { mode: "sum", amount: 5000 } })), `от 19${NB}000 до 22${NB}600 ₽`);
});

test("диапазон НДС: «от +… до +…» в расчёте и итог с налогом у обоих концов", () => {
  const html = smeta({
    groups: [{ id: "g1", name: "Ткань" }],
    items: [
      { ...POZICIYA, id: "a", quantity: 1, price: 5000 },
      { ...POZICIYA, id: "b", groupId: "g1", quantity: 1, price: 10000, vatEnabled: true },
      { ...POZICIYA, id: "c", groupId: "g1", quantity: 1, price: 14000, vatEnabled: true },
    ],
  });
  assert.equal(stroka(html, "НДС 22%"), `от +2${NB}200 до +3${NB}080 ₽`);
  assert.equal(itogo(html), `от 17${NB}200 до 22${NB}080 ₽`);
});

test("равные варианты группы — одно число, а не «от … до …»: количество, сумма и итог", () => {
  const html = smeta({
    groups: [{ id: "g1", name: "Ткань" }],
    items: [
      { ...POZICIYA, id: "a", quantity: 1, price: 5000 },
      { ...POZICIYA, id: "b", groupId: "g1", quantity: 2, price: 10000 },
      { ...POZICIYA, id: "c", groupId: "g1", quantity: 2, price: 10000 },
    ],
  });
  assert.equal(stroka(html, "Количество позиций"), "3 шт.");
  assert.equal(stroka(html, "Сумма"), `15${NB}000 ₽`);
  assert.equal(itogo(html), `15${NB}000 ₽`);
  assert.ok(html.includes(`<b>15${NB}000</b> <span class="tb-w">₽</span>`));
  assert.doesNotMatch(tekst(html), /от \d[\d ]* до/);
});

test("монтаж: included и free — словами (чип), итог не двигают; sum — числом и прибавляется к итогу; none, null и нет поля — строки нет", () => {
  const itogoBez = `10${NB}000 ₽`;
  for (const montage of [undefined, null, { mode: "none" }]) {
    const html = smeta({ montage });
    assert.equal(stroka(html, "Монтаж"), null, JSON.stringify(montage));
    assert.equal(itogo(html), itogoBez);
  }
  const vklyuchen = smeta({ montage: { mode: "included" } });
  assert.equal(stroka(vklyuchen, "Монтаж"), "включён в стоимость");
  assert.match(vklyuchen, /<span class="t-chip"><svg[\s\S]*?<\/svg>включён в стоимость<\/span>/);
  assert.equal(itogo(vklyuchen), itogoBez);

  const besplatno = smeta({ montage: { mode: "free" } });
  assert.equal(stroka(besplatno, "Монтаж"), "бесплатно");
  assert.equal(itogo(besplatno), itogoBez);

  const summa = smeta({ montage: { mode: "sum", amount: 5000 } });
  assert.equal(stroka(summa, "Монтаж"), `5${NB}000 ₽`);
  assert.equal(itogo(summa), `15${NB}000 ₽`);

  // Сумма не число или не больше нуля: показывается «0 ₽», итог не двигается
  for (const amount of [-300, "abc", null, undefined]) {
    const html = smeta({ montage: { mode: "sum", amount } });
    assert.equal(stroka(html, "Монтаж"), "0 ₽", String(amount));
    assert.equal(itogo(html), itogoBez, String(amount));
  }
});

test("плашки: скидка по акции — только при promoDiscount (с процентом), «НДС 5%» — только при vatIncluded5; обе стоят под расчётом", () => {
  const bez = BEZ_STILEI(smeta({}));
  assert.doesNotMatch(bez, /class="promo-banner"|class="vat-included-banner"/);

  const s = BEZ_STILEI(smeta({ promoDiscount: 15, vatIncluded5: true }));
  assert.match(s, /<span class="bn-txt">При заказе от 2 изделий действует скидка на весь заказ в размере 15%<\/span>/);
  assert.match(s, /<span class="bn-txt">Указанные цены уже включают НДС 5% \(налог включён в стоимость\)\.<\/span>/);
  assert.ok(s.indexOf("blk-totals") < s.indexOf('class="promo-banner"'));
  assert.ok(s.indexOf('class="promo-banner"') < s.indexOf('class="vat-included-banner"'));
  assert.ok(s.indexOf('class="vat-included-banner"') < s.indexOf('class="tb-note'));

  const tolkoAkciya = BEZ_STILEI(smeta({ promoDiscount: 25 }));
  assert.match(tolkoAkciya, /в размере 25%/);
  assert.doesNotMatch(tolkoAkciya, /class="vat-included-banner"/);
  const tolkoNds = BEZ_STILEI(smeta({ vatIncluded5: true }));
  assert.doesNotMatch(tolkoNds, /class="promo-banner"/);
  assert.match(tolkoNds, /НДС 5%/);
  // promoDiscount 0 и null — плашки нет
  for (const promoDiscount of [0, null]) assert.doesNotMatch(smeta({ promoDiscount }), /class="promo-banner"/);
});

test("экранирование: <script>, теги и кавычки в клиенте, номере, названии и материале попадают в страницу текстом, а не разметкой", () => {
  const html = smeta({
    clientData: {
      appealId: '#7"><script>alert(1)</script>', clientName: "<img src=x onerror=alert(1)>", phone: "<b>1</b>",
      city: "</div><i>x</i>", address: '"><svg onload=alert(1)>',
    },
    items: [{ ...POZICIYA, productLabel: "<script>alert(2)</script>", materialName: '"><u>m</u>' }],
  });
  assert.ok(!/<script/i.test(html), "в странице появился <script");
  for (const opasnoe of ["<img src=x", "<svg onload", "<b>1</b>", "<i>x</i>", "<u>m</u>", "onerror=alert(1)>", "alert(2)</script>"]) {
    assert.ok(!html.includes(opasnoe), opasnoe);
  }
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;")); // имя клиента
  assert.ok(html.includes('<div class="cd-name">&lt;script&gt;alert(2)&lt;/script&gt;</div>')); // название позиции
  assert.ok(html.includes("&quot;&gt;&lt;u&gt;m&lt;/u&gt;")); // материал
  assert.ok(html.includes("Обращение #7&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;")); // номер в плитке клиента
  assert.ok(html.includes(`№${NB}7&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;`)); // и в плитке документа
  // Первая буква имени клиента — в аватар-кружке, тоже экранирована
  assert.ok(html.includes('<span class="cl-ava" aria-hidden="true">&lt;</span>'));
});

test("номер обращения с «</style>», кавычкой, обратной косой и переводом строки не выходит из CSS-строки подвала", () => {
  const opasnye = [
    "#1</style><script>alert(1)</script>",
    '#1"; } body{display:none} /*',
    "#12\n}\r\n@page{size:1pt}",
    "#\\22 x\\",
    "#</style><img src=x onerror=1>",
  ];
  for (const appealId of opasnye) {
    const html = smeta({ clientData: { appealId, clientName: "Иванов" } });
    assert.equal((html.match(/<style/gi) || []).length, 1, JSON.stringify(appealId));
    assert.equal((html.match(/<\/style>/gi) || []).length, 1, JSON.stringify(appealId));
    assert.ok(!/<script|<img src=x/i.test(html), JSON.stringify(appealId));
    // Строка закрывается там, где надо: сразу за ней идёт следующее свойство margin-бокса
    const m = html.match(/@bottom-left \{\s*content: "((?:[^"\\\n\r]|\\[^\n\r])*)";\s*margin-left: 10mm;/);
    assert.ok(m, `строка подвала разорвана: ${JSON.stringify(appealId)}`);
    assert.match(m[1], /^SUNRAY · КП №/);
    assert.ok(!/[<>&"'\n\r]/.test(m[1]), `в строке подвала остался опасный знак: ${JSON.stringify(m[1])}`);
    // Правая половина подвала цела
    assert.equal(html.split('content: "Лист " counter(page) " из " counter(pages);').length, 2);
  }
  // Спецзнаки превращаются в CSS-коды: «<» → \3c, «"» → \22, перевод строки → \a
  const m = smeta({ clientData: { appealId: '#<"\nx' } }).match(/@bottom-left \{\s*content: "([^;]*)";/);
  assert.equal(m[1], "SUNRAY · КП №\\3c \\22 \\a x");
});

test("подвал слева: «SUNRAY · КП №…» без решётки и не длиннее 18 знаков номера; без номера обращения — пусто", () => {
  const levo = (html) => html.match(/@bottom-left \{\s*content: "([^"]*)";/)[1];
  assert.equal(levo(smeta({})), "SUNRAY · КП №09784");
  assert.equal(levo(smeta({ clientData: { appealId: "#" + "1234567890".repeat(3) } })), "SUNRAY · КП №123456789012345678");
  assert.equal(levo(smeta({ clientData: { clientName: "Без номера" } })), "");
  assert.equal(levo(smeta({ clientData: null })), "");
});

test("лист A5: @page 420pt × 595pt, поля 12 мм сверху (на первом листе 0), 16 мм снизу, боковых нет; подвал «Лист k из M»", () => {
  const html = smeta({});
  assert.match(html, /@page \{\s*size: 420pt 595pt;\s*margin: 12mm 0 16mm 0;/);
  assert.match(html, /@page :first \{ margin-top: 0; \}/);
  assert.match(html, /@bottom-right \{\s*content: "Лист " counter\(page\) " из " counter\(pages\);/);
  assert.doesNotMatch(html, /size:\s*A4|size:\s*148mm/);
  assert.equal((html.match(/@page\s*\{/g) || []).length, 1); // @page один
});

test("плитка: «Коммерческое предложение», № и день составления, логотип data:-картинкой", () => {
  const html = smeta({ createdDay: "2026-09-12" });
  assert.match(html, /<h1 class="pl-h">Коммерческое предложение<\/h1>/);
  assert.match(html, /<div class="pl-no">№\u00a009784<\/div>/);
  assert.match(html, /<div class="pl-dt">от\u00a012\.09\.2026<\/div>/);
  assert.match(html, /<img class="pl-logo" src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="SUNRAY">/);
  // Без номера обращения и дня составления в плитке их нет
  const bez = smeta({ clientData: { clientName: "Без номера" }, createdDay: null });
  assert.doesNotMatch(bez, /class="pl-no"|class="pl-dt"/);
});

test("правила листов: блоки .blk неразрывны, плитка и клиент держатся со следующим, последняя карточка с расчётом — одна связка .tail", () => {
  const html = smeta({});
  assert.match(html, /\.blk \{ break-inside: avoid;/);
  assert.match(html, /\.tail \{ page: final; [^}]*break-inside: avoid;/);
  assert.match(html, /\.blk\.keep-next \{ break-after: avoid;/);
  assert.match(html, /\.bleed \{[^}]*break-after: avoid;/);

  const razmetka = (h) => h.replace(/<style>[\s\S]*?<\/style>/, "");
  for (const blok of ['<div class="bleed">', '<div class="blk blk-client gap-m keep-next">', '<div class="blk blk-totals gap-m">', '<div class="tb-note', '<div class="tb">']) {
    assert.ok(razmetka(html).includes(blok), blok);
  }
  // Две и больше позиций: последняя карточка лежит внутри .tail, перед расчётом, остальные — до связки
  const tri = razmetka(smeta({ items: [POZICIYA, DRUGAYA, { ...DRUGAYA, id: "p3" }] }));
  const karty = [...tri.matchAll(/blk blk-card/g)].map((m) => m.index);
  const tail = tri.indexOf('<div class="tail">');
  const itogi = tri.indexOf("blk blk-totals");
  assert.equal(karty.length, 3);
  assert.ok(karty[1] < tail && tail < karty[2] && karty[2] < itogi);
  // Одна позиция: связка есть, но карточка остаётся с шапкой, вне связки
  const odna = razmetka(html);
  assert.ok(odna.indexOf("blk blk-card") < odna.indexOf('<div class="tail">'));
  assert.ok(odna.indexOf('<div class="tail">') < odna.indexOf("blk blk-totals"));
});

test("без клиента и без номера смета собирается: плитки клиента нет, подвал слева пуст", () => {
  const html = smeta({ clientData: null });
  assert.doesNotMatch(html.replace(/<style>[\s\S]*?<\/style>/, ""), /class="blk blk-client/);
  assert.match(html, /<div class="cd-name">Рулонная штора MINI<\/div>/);
  assert.equal(itogo(html), `10${NB}000 ₽`);
});

test("нижняя плитка: «Итого к оплате» с суммой и реквизиты компании; ромба, рубинового акцента, подписи и печати нет", () => {
  const html = smeta({});
  const razmetka = BEZ_STILEI(html);
  assert.match(razmetka, /<div class="tb">\s*<div class="tb-strip">\s*<span class="tb-label">Итого к оплате<\/span>/);
  assert.equal(itogo(html), `10${NB}000 ₽`);
  // Реквизиты исполнителя лежат в самой плитке, после строки «Итого»
  const plitka = razmetka.slice(razmetka.indexOf('<div class="tb">'));
  for (const rekvizit of ["Индивидуальный предприниматель", "Журович-Миронова Дарья Васильевна", "ИНН", "910502074977", "ОГРНИП", "321911200058121", "+7 (999) 810-77-17", "sunray-zhalyuzi@yandex.ru", "zhalyuzi-sunray.ru"]) {
    assert.ok(plitka.includes(rekvizit), rekvizit);
  }
  // Прежний низ листа не вернулся: ромб и рубиновый кант у итога, отдельные блоки срока и исполнителя, подпись и печать
  assert.doesNotMatch(html, /f-gem|totals-final|blk-valid|blk-req|#c2183f|#d81b4a|stamp|Подпись и печать/i);
});

test("последний лист без подвала: страница final (связка .tail) без нижнего поля, «Лист k из M», «SUNRAY · КП №…» и линии над ними; на остальных листах подвал есть", () => {
  const html = smeta({});
  // Блок CSS от начала nachalo до парной закрывающей скобки (внутри @page вложены margin-боксы)
  const blok = (nachalo) => {
    const s = html.indexOf(nachalo);
    assert.ok(s >= 0, nachalo);
    let glubina = 0;
    for (let i = html.indexOf("{", s); i < html.length; i++) {
      if (html[i] === "{") glubina++;
      else if (html[i] === "}" && --glubina === 0) return html.slice(s, i + 1);
    }
    throw new Error(`нет закрывающей скобки: ${nachalo}`);
  };
  // Обычные листы: поле снизу 16 мм, подвал слева и справа, над каждой половиной подвала линия
  const obychnyj = blok("@page {");
  assert.match(obychnyj, /margin: 12mm 0 16mm 0;/);
  assert.match(obychnyj, /@bottom-left \{[^}]*border-top: 1px solid #e6dfcd;/);
  assert.match(obychnyj, /@bottom-right \{[^}]*content: "Лист " counter\(page\) " из " counter\(pages\);[^}]*border-top: 1px solid #e6dfcd;/);
  // Последний лист: нижнего поля нет, обе половины подвала пусты и без линии
  const posledniy = blok("@page final");
  assert.match(posledniy, /margin-bottom: 0;/);
  assert.match(posledniy, /@bottom-left \{ content: none; margin: 0; padding: 0; border: 0; \}/);
  assert.match(posledniy, /@bottom-right \{ content: none; margin: 0; padding: 0; border: 0; \}/);
  // На этой странице стоит только связка .tail, и в ней — расчёт, срок КП и нижняя плитка; на остальные блоки она не распространяется
  const bezKomment = html.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(bezKomment, /\.tail \{ page: final;/);
  assert.equal((bezKomment.match(/page: final/g) || []).length, 1);
  const razmetka = BEZ_STILEI(html);
  const tail = razmetka.indexOf('<div class="tail">');
  assert.ok(tail >= 0 && tail < razmetka.indexOf("blk-totals") && razmetka.indexOf("blk-totals") < razmetka.indexOf('<div class="tb-note') && razmetka.indexOf('<div class="tb-note') < razmetka.indexOf('<div class="tb">'));
});

test("заголовок страницы: «Коммерческое предложение № номер» как в подвале, без номера обращения — без номера; номер экранируется и режется до 18 знаков", () => {
  assert.match(smeta({}), /<title>Коммерческое предложение № 09784<\/title>/);
  assert.match(smeta({ clientData: { clientName: "Без номера" } }), /<title>Коммерческое предложение<\/title>/);
  assert.match(smeta({ clientData: null }), /<title>Коммерческое предложение<\/title>/);
  assert.match(smeta({ clientData: { appealId: "#" + "1234567890".repeat(3) } }), /<title>Коммерческое предложение № 123456789012345678<\/title>/);
  // <title> изнутри не закрывается: теги из номера попадают текстом
  const opasnyj = smeta({ clientData: { appealId: "#1</title><script>alert(1)</script>" } });
  assert.equal((opasnyj.match(/<title>/g) || []).length, 1);
  assert.equal((opasnyj.match(/<\/title>/g) || []).length, 1);
  assert.ok(!/<script/i.test(opasnyj));
  assert.ok(opasnyj.includes("<title>Коммерческое предложение № 1&lt;/title&gt;&lt;script&gt;a</title>"));
});

test("чип «Обращение #…» не растягивается длинным номером: не шире половины карточки, лишнее — многоточием; обычный номер чип не меняет", () => {
  const html = smeta({});
  assert.match(html, /\.cl-id \{ flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;/); // flex: none — чип не сжимается, пока короче половины
  assert.match(BEZ_STILEI(html), /<div class="cl-id">Обращение #09784<\/div>/);
});
