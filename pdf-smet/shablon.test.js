"use strict";

// Шаблон сметы без Chrome (PLANS/SERVER/05-pdf-smet, буква Б; вид A5 — 19.10.2026): имя файла, день печати по Москве, числа тела, срок КП (обе формы),
// экранирование (в том числе «</style>» в номере обращения: подвал листа — CSS-строка в @page) и смысл разметки: позиции и суммы, скидка,
// НДС 22 %, группы «Гр. N», диапазон «от … до …», монтаж, плашки акции и НДС 5 %, правила листов, последний лист без подвала, нижняя плитка.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test pdf-smet/shablon.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildHtml, dozapolnitPozicii, imyaFayla, denPechati, privestiChisla, SUPABASE_URL,
  planKompakta, gorodObekta, SITE_HOST_RE, estCardCompact, estLinesM,
  CP_A5, CP_PC, CP_PL_H, CP_ONE_SAFE, CP_TAIL_SAFE, CP_TAIL_SAFE_PER_CARD, CP_PACK_SAFE,
} = require("./shablon");

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

// --- буква Б (20.10.2026): цена за штуку (priceMode 'unit') и акция «от N изделий» ---

const ZA_SHTUKU = { ...POZICIYA, id: "u1", priceMode: "unit", quantity: 2, price: 1000 }; // 2 шт. по 1 000 ₽: база 2 000 ₽
// Текст плашки акции вместе с её разметкой (содержимое .bn-txt)
const plashkaAkcii = (html) => (BEZ_STILEI(html).match(/<div class="promo-banner">\s*<span class="bn-ico">[\s\S]*?<\/span>\s*<span class="bn-txt">([\s\S]*?)<\/span>/) || [])[1] ?? null;

test("цена за штуку: база = цена × количество; 2 шт. по 1 000 ₽ → 2 000, скидка 10 % → 1 800, НДС 22 % → 2 196; за всю позицию (и без priceMode) 1 000 → 1 000; готовые цифры CRM не затираются", () => {
  const [u] = dozapolnitPozicii([{ ...ZA_SHTUKU, discountPercent: 10, vatEnabled: true }]);
  assert.deepEqual([u.discountedPrice, u.vatAmount, u.finalPriceWithVat], [1800, 396, 2196]);
  const [bezSkidki] = dozapolnitPozicii([ZA_SHTUKU]);
  assert.deepEqual([bezSkidki.discountedPrice, bezSkidki.finalPriceWithVat], [2000, 2000]);
  for (const priceMode of ["total", undefined]) {
    const [z] = dozapolnitPozicii([{ ...ZA_SHTUKU, priceMode }]);
    assert.deepEqual([z.discountedPrice, z.finalPriceWithVat], [1000, 1000], String(priceMode)); // количество на цену не умножается
  }
  // Акцию CRM считает сама и шлёт эффективные цифры: 15 % от базы 2 000 = 1 700, НДС 374, итог 2 074 — сервер их оставляет как есть
  const [gotovye] = dozapolnitPozicii([{ ...ZA_SHTUKU, discountPercent: 15, discountedPrice: 1700, vatEnabled: true, vatAmount: 374, finalPriceWithVat: 2074 }]);
  assert.deepEqual([gotovye.discountedPrice, gotovye.vatAmount, gotovye.finalPriceWithVat], [1700, 374, 2074]);
});

test("цена за штуку на листе: над ценником строка «2 × 1 000 ₽», зачёркнута база 2 000, итог 2 196; «Расчёт» и «Итого к оплате» считаются от базы; у позиции «за всю позицию» строки нет", () => {
  const html = smeta({ items: [{ ...ZA_SHTUKU, discountPercent: 10, vatEnabled: true }, { ...DRUGAYA, quantity: 2 }] });
  const [u, z] = kartochki(html);
  assert.ok(u.includes(`<div class="cd-unit">2${NB}×${NB}1${NB}000 ₽</div>`));
  assert.ok(u.includes(`<s class="cd-old">2${NB}000 ₽</s><span class="cd-off">${MINUS}10%</span>`));
  assert.ok(u.includes(`<div class="cd-r2">1${NB}800 ₽</div>`));
  assert.ok(u.includes(`<div class="cd-vat">+ НДС 22% · 396 ₽</div>`));
  assert.ok(u.includes(`<div class="cd-fin">2${NB}196 ₽</div>`));
  assert.ok(u.indexOf("cd-unit") < u.indexOf("cd-old") && u.indexOf("cd-old") < u.indexOf("cd-fin"), "строка «2 × 1 000 ₽» стоит над ценником");
  assert.doesNotMatch(z, /cd-unit/);
  assert.ok(z.includes(`<div class="cd-fin">5${NB}500 ₽</div>`));
  // База 2 000 + 5 500 = 7 500; скидка 200; после скидки 7 300; НДС 396; итог 2 196 + 5 500 = 7 696
  assert.equal(stroka(html, "Сумма без скидки"), `7${NB}500 ₽`);
  assert.equal(stroka(html, "Скидка"), `${MINUS}200 ₽`);
  assert.equal(stroka(html, "После скидки"), `7${NB}300 ₽`);
  assert.equal(stroka(html, "НДС 22%"), "+396 ₽");
  assert.equal(itogo(html), `7${NB}696 ₽`);
  // НДС без скидки: «Цена …» — тоже база
  const [c] = kartochki(smeta({ items: [{ ...ZA_SHTUKU, vatEnabled: true }] }));
  assert.ok(c.includes(`<div class="cd-pre">Цена 2${NB}000 ₽</div>`));
  assert.ok(c.includes(`<div class="cd-fin">2${NB}440 ₽</div>`));
  // Строка и её правило CSS есть только там, где есть позиция «за штуку»
  assert.ok(smeta({ items: [ZA_SHTUKU] }).includes(".cd-unit {"));
  for (const bez of [smeta({}), smeta({ items: [{ ...ZA_SHTUKU, priceMode: "total" }] })]) assert.ok(!bez.includes("cd-unit"), "у «за всю позицию» строки и правила CSS нет");
});

test("цена за штуку в группах вариантов: «Сумма без скидки», «Скидка», «После скидки» и итог — диапазоны от баз вариантов", () => {
  const html = smeta({
    groups: [{ id: "g1", name: "Ткань" }],
    items: [
      { ...ZA_SHTUKU, id: "a" }, // вне групп: база 2 000
      { ...POZICIYA, id: "b", groupId: "g1", priceMode: "unit", quantity: 2, price: 5000, discountPercent: 10 }, // вариант 1: база 10 000 → 9 000
      { ...POZICIYA, id: "c", groupId: "g1", quantity: 1, price: 12000, discountPercent: 5, discountedPrice: 11400 }, // вариант 2: за всю позицию 12 000 → 11 400
    ],
  });
  assert.equal(stroka(html, "Сумма без скидки"), `от 12${NB}000 до 14${NB}000 ₽`);
  assert.equal(stroka(html, "Скидка"), `от ${MINUS}600 до ${MINUS}1${NB}000 ₽`);
  assert.equal(stroka(html, "После скидки"), `от 11${NB}000 до 13${NB}400 ₽`);
  assert.equal(itogo(html), `от 11${NB}000 до 13${NB}400 ₽`);
});

test("плашка акции: «от N изделий» берётся из promoFromQty и стоит жирным цветом акцента; без promoFromQty и при N = 2 слова те же дословно; акции нет — нет и правила CSS", () => {
  const STARYJ = "При заказе от 2 изделий действует скидка на весь заказ в размере 15%";
  // тело без promoFromQty (старая смета): разметка и CSS прежние, без акцента
  const staraya = smeta({ promoDiscount: 15 });
  assert.equal(plashkaAkcii(staraya), STARYJ);
  assert.ok(!staraya.includes("promo-cond"));
  // N = 2 в новом теле: слова те же, условие выделено
  const dva = smeta({ promoDiscount: 15, promoFromQty: 2 });
  assert.equal(plashkaAkcii(dva), 'При заказе <b class="promo-cond">от 2 изделий</b> действует скидка на весь заказ в размере 15%');
  assert.equal(tekst(plashkaAkcii(dva)), STARYJ);
  // N = 5, X = 15
  const pyat = smeta({ promoDiscount: 15, promoFromQty: 5 });
  assert.equal(plashkaAkcii(pyat), 'При заказе <b class="promo-cond">от 5 изделий</b> действует скидка на весь заказ в размере 15%');
  assert.match(pyat, /\.promo-banner \.promo-cond \{ font-weight: 700; color: #a34a0b;/);
  // акции нет — плашки и правила нет, даже если promoFromQty прислан
  for (const promoDiscount of [null, 0]) assert.ok(!smeta({ promoDiscount, promoFromQty: 5 }).includes("promo-cond"));
});

test("связка .tail: оценка высоты карточки «за штуку» выше на строку «N × цена» — на грани листа такая последняя карточка уходит из связки, а «за всю позицию» остаётся в ней", () => {
  // Последняя карточка — только скидка, короткое название; вокруг — НДС у первой позиции, обе плашки и монтаж-чип: связка у самой границы листа
  const smetaSPoslednej = (priceMode) => smeta({
    items: [{ ...POZICIYA, id: "a", vatEnabled: true }, { id: "z", productLabel: "Штора", quantity: 2, price: 1000, priceMode, discountPercent: 10, discountedPrice: priceMode === "unit" ? 1800 : 900 }],
    promoDiscount: 15, vatIncluded5: true, montage: { mode: "included" },
  });
  const vSvyazke = (html) => { const v = BEZ_STILEI(html); return v.lastIndexOf('<div class="cd"') > v.indexOf('<div class="tail">'); };
  assert.equal(vSvyazke(smetaSPoslednej("total")), true);
  assert.equal(vSvyazke(smetaSPoslednej("unit")), false);
});

// --- буква В (20.10.2026): помещения (секции с итогом) и размеры позиций ---

// Позиция без скидки и НДС: итог = цена. room === undefined — поля нет совсем
const poz = (id, room, price, dop = {}) => ({ id, productLabel: `Штора ${id}`, quantity: 1, price, ...(room === undefined ? {} : { room }), ...dop });
// Заголовки помещений текстом по порядку на листе: «Кухня — 4 000 ₽»
const zagolovkiKomnat = (html) => [...BEZ_STILEI(html).matchAll(/<div class="rm">([\s\S]*?)<\/span><\/div>/g)].map((m) => tekst(m[1]));
// Названия позиций в порядке показа и номера в кружках
const poryadok = (html) => [...BEZ_STILEI(html).matchAll(/<div class="cd-name">(.*?)<\/div>/g)].map((m) => m[1]);
const nomera = (html) => [...BEZ_STILEI(html).matchAll(/<span class="cd-num">(\d+)<\/span>/g)].map((m) => m[1]);

test("помещения: секции идут в порядке ПЕРВОГО появления помещения, позиции внутри — в порядке тела, номера карточек подряд; заголовок «Кухня — сумма» стоит над первой карточкой секции", () => {
  const html = smeta({ items: [poz("a", "Кухня", 1000), poz("b", "Спальня", 2000), poz("c", "Кухня", 3000), poz("d", "Спальня", 4000), poz("e", "Гостиная", 5000)] });
  assert.deepEqual(zagolovkiKomnat(html), [`Кухня — 4${NB}000 ₽`, `Спальня — 6${NB}000 ₽`, `Гостиная — 5${NB}000 ₽`]);
  assert.deepEqual(poryadok(html), ["Штора a", "Штора c", "Штора b", "Штора d", "Штора e"]);
  assert.deepEqual(nomera(html), ["1", "2", "3", "4", "5"]);
  // заголовок и первая карточка — один неразрывный блок: заголовок не остаётся один внизу листа
  const bloki = BEZ_STILEI(html).split('<div class="blk blk-card blk-rhead">').slice(1);
  assert.equal(bloki.length, 3);
  for (const b of bloki) assert.ok(b.indexOf('<div class="rm">') < b.indexOf('<div class="cd"') && b.indexOf('<div class="cd"') < b.indexOf('<div class="blk'), "заголовок, затем первая карточка секции — в одном блоке");
  assert.match(html, /\.blk \{ break-inside: avoid;/);
  assert.match(html, /\.blk-card \+ \.blk-rhead \{ margin-top: 8px; \}/);
});

test("помещения: «кухня», «Кухня», «Кухня  », «КУХНЯ» и «Зелёная  комната» / «зеленая комната» — одна секция каждое, показ как введено первым (пробелы по краям убраны, повторные — в один)", () => {
  const html = smeta({ items: [poz("a", "Кухня ", 1000), poz("b", "Зелёная  комната", 100), poz("c", "кухня", 2000), poz("d", " КУХНЯ", 3000), poz("e", "зеленая комната", 200), poz("f", "Кухня  ", 4000)] });
  assert.deepEqual(zagolovkiKomnat(html), [`Кухня — 10${NB}000 ₽`, `Зелёная комната — 300 ₽`]);
  assert.deepEqual(poryadok(html), ["Штора a", "Штора c", "Штора d", "Штора f", "Штора b", "Штора e"]);
});

test("помещения: позиции без помещения (нет поля, null, пусто, одни пробелы, «без помещения» руками) — последней секцией «Без помещения»; помещения нет ни у одной — секций нет, разметка как без поля", () => {
  const html = smeta({ items: [poz("a", undefined, 1000), poz("b", "Кухня", 2000), poz("c", "   ", 3000), poz("d", null, 4000), poz("e", "Без  помещения", 5000)] });
  assert.deepEqual(zagolovkiKomnat(html), [`Кухня — 2${NB}000 ₽`, `Без помещения — 13${NB}000 ₽`]);
  assert.deepEqual(poryadok(html), ["Штора b", "Штора a", "Штора c", "Штора d", "Штора e"]);
  // помещения нет ни у кого: ни заголовков, ни блока-обёртки, ни правил CSS; страница та же, что для тела без поля room
  const pustye = [poz("a", "", 1000), poz("b", "   ", 2000), poz("c", null, 3000), poz("d", "Без помещения", 4000)];
  const bezPolya = pustye.map(({ room, ...ostalnoe }) => ostalnoe);
  const bez = smeta({ items: pustye });
  assert.equal(bez, smeta({ items: bezPolya }));
  assert.ok(!bez.includes('class="rm"') && !bez.includes("blk-rhead") && !bez.includes(".rm {"));
});

test("итог помещения: сумма итогов позиций после скидки и НДС; с группой вариантов — «от … до …» (обычные + минимум / максимум группы); в группе только позиции ЭТОГО помещения; min = max — одно число", () => {
  const groups = [{ id: "g1", name: "Ткань" }, { id: "g2", name: "Цвет" }];
  const html = smeta({
    groups,
    items: [
      poz("k1", "Кухня", 10000),
      poz("k2", "Кухня", 5000, { groupId: "g1", discountPercent: 10, discountedPrice: 4500, vatEnabled: true, vatAmount: 990, finalPriceWithVat: 5490 }), // вариант 1: итог 5 490
      poz("k3", "Кухня", 8000, { groupId: "g1" }), // вариант 2: итог 8 000
      poz("s1", "Спальня", 7000),
      poz("s2", "Спальня", 3000),
      poz("d1", "Детская", 2000, { groupId: "g2" }), // второй вариант группы g2 — в Гостиной
      poz("g1", "Гостиная", 9000, { groupId: "g2" }),
    ],
  });
  assert.deepEqual(zagolovkiKomnat(html), [
    `Кухня — от 15${NB}490 до 18${NB}000 ₽`, // 10 000 + min(5 490; 8 000) … 10 000 + max
    `Спальня — 10${NB}000 ₽`, // min = max
    `Детская — 2${NB}000 ₽`, // в группе g2 здесь один вариант
    `Гостиная — 9${NB}000 ₽`,
  ]);
  // без групп сумма итогов помещений (с «Без помещения») равна «Итого к оплате»: НДС и скидка учтены
  const bezGrupp = smeta({
    items: [poz("a", "Кухня", 3000, { vatEnabled: true, vatAmount: 660, finalPriceWithVat: 3660 }), poz("b", "Спальня", 4000, { discountPercent: 10, discountedPrice: 3600 }), poz("c", undefined, 1000)],
  });
  assert.deepEqual(zagolovkiKomnat(bezGrupp), [`Кухня — 3${NB}660 ₽`, `Спальня — 3${NB}600 ₽`, `Без помещения — 1${NB}000 ₽`]);
  assert.equal(itogo(bezGrupp), `8${NB}260 ₽`);
});

test("помещение идёт в страницу через escapeHtml и не длиннее 60 знаков: теги и кавычки не становятся разметкой, 70 знаков режутся до 60", () => {
  const html = smeta({ items: [poz("a", `<script>alert(1)</script> & "x"`, 1000), poz("b", "Ж".repeat(70), 2000)] });
  assert.ok(html.includes('<span class="rm-name">&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</span>'));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes(`<span class="rm-name">${"Ж".repeat(60)}</span>`) && !html.includes("Ж".repeat(61)));
  assert.deepEqual(zagolovkiKomnat(html), [`&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; — 1${NB}000 ₽`, `${"Ж".repeat(60)} — 2${NB}000 ₽`]);
});

test("размеры: «1 200 × 1 400 мм» мелкой строкой под материалом; без размеров (или только один из двух) строки нет, а правила CSS нет, пока размеров нет ни у кого", () => {
  const sRazmerami = poz("a", undefined, 1000, { materialName: "Лён", widthMm: 1200, heightMm: 1400 });
  const html = smeta({ items: [sRazmerami, poz("b", undefined, 2000, { widthMm: 900 })] });
  const [a, b] = kartochki(html);
  assert.ok(a.includes(`<div class="cd-mat">Лён</div><div class="cd-size">1${NB}200${NB}×${NB}1${NB}400${NB}мм</div>`));
  assert.ok(a.indexOf("cd-size") < a.indexOf("cd-meta"));
  assert.doesNotMatch(b, /cd-size/);
  assert.match(html, /\.cd-size \{ margin-top: 2px; font-size: 12\.5px; font-weight: 500;/);
  assert.ok(!smeta({ items: [poz("b", undefined, 2000, { widthMm: 900 })] }).includes("cd-size"));
});

test("связка .tail учитывает заголовок помещения: последняя карточка — первая в своей секции → заголовок идёт с ней и на грани листа она уходит из связки; в одной секции с предыдущей — остаётся", () => {
  const smetaSPoslednej = (komnata) => smeta({
    items: [{ ...POZICIYA, id: "a", vatEnabled: true, room: "Кухня" }, { id: "z", productLabel: "Штора", quantity: 2, price: 1000, discountPercent: 10, discountedPrice: 900, room: komnata }],
    promoDiscount: 15, vatIncluded5: true, montage: { mode: "included" },
  });
  const vSvyazke = (html) => { const v = BEZ_STILEI(html); return v.lastIndexOf('<div class="cd"') > v.indexOf('<div class="tail">'); };
  assert.equal(vSvyazke(smetaSPoslednej("Кухня")), true);
  assert.equal(vSvyazke(smetaSPoslednej("Спальня")), false);
});

// --- формат листа «компактный» / «ПК» и город объекта (20.10.2026): sheet, cityContext, раскладка planKompakta ---
// Числа листа (запасы, границы, высоты) в проверках ниже записаны ЛИТЕРАЛАМИ, а не берутся из экспорта шаблона: это замеры печати Chrome (20.10.2026), и проверка, пересчитывающая их из самого
// кода, не заметила бы случайной правки константы. Перекалибровали лист — поправьте числа здесь же (мутационная проверка: правка любой из них краснит тесты).

const FORMATY_LISTA = ["big", "compact", "pc"];
const OSNOVNOY_SAYT = "zhalyuzi-sunray.ru";
const GOROD_ISTRA = { name: "Истра", siteHost: "istra.zhalyuzi-sunray.ru" };
// n позиций POZICIYA: «Штора 1», «Штора 2»…; dop(i) — поля i-й позиции
const pozicii = (n, dop = () => ({})) => Array.from({ length: n }, (_, i) => ({ ...POZICIYA, id: `p${i + 1}`, productLabel: `Штора ${i + 1}`, ...dop(i) }));
const skolko = (tekst, podstroka) => tekst.split(podstroka).length - 1;
// Логотип — base64, и «NaN» или «undefined» в нём бывают случайной подстрокой: перед поиском мусора data:-адреса вырезаем
const BEZ_DATA = (html) => html.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, "data:");
// Левый край подвала — строка content: "…" margin-бокса @bottom-left; null — строка разорвана (закрывающей кавычки нет там, где она должна быть)
const levyPodval = (html) => {
  const m = html.match(/@bottom-left \{\s*content: "((?:[^"\\\n\r]|\\[^\n\r])*)";\s*margin-left: 10mm;/);
  return m ? m[1] : null;
};
// Парный <div …>…</div>, начинающийся с nachalo; null — такого блока нет или он не закрыт
function blokDiv(razmetka, nachalo) {
  const s = razmetka.indexOf(nachalo);
  if (s < 0) return null;
  let glubina = 0;
  for (const m of razmetka.slice(s).matchAll(/<div[\s>]|<\/div>/g)) {
    glubina += m[0] === "</div>" ? -1 : 1;
    if (glubina === 0) return razmetka.slice(s, s + m.index + m[0].length);
  }
  return null;
}
const tegi = (razmetka) => new Set([...razmetka.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase()));
// Действующая ширина margin-бокса подвала: в блоке бокса основного @page последнее объявление width (с городом и номером оно расширяет левую часть, перекрывая общее 50 %)
const shirinaPodvala = (html, bok) => [...html.match(new RegExp(`@${bok} \\{([^}]*)\\}`))[1].matchAll(/width: ([^;]+);/g)].at(-1)[1];

test("формат листа: sheet не задан, null, '', 'big', 'BIG', 'xl', 0, {} и прочий мусор — большой лист, HTML побайтно как без поля (два образца)", () => {
  const obrazcy = [
    {},
    {
      clientData: { appealId: "#7", clientName: "Иванов Иван", phone: "8(900)111-22-33", city: "Химки", address: "ул. Длинная, д. 1, кв. 2" },
      items: DIAPAZON.items, groups: DIAPAZON.groups, promoDiscount: 15, promoFromQty: 3, vatIncluded5: true,
      montage: { mode: "sum", amount: 5000 }, validUntil: "2026-10-22", cityContext: GOROD_ISTRA,
    },
  ];
  const musor = [undefined, null, "", "big", "BIG", "xl", "Compact", "COMPACT", "PC", " pc", "pc ", "compact\n", 0, 1, false, true, {}, [], ["pc"], { sheet: "pc" }];
  for (const obrazec of obrazcy) {
    const bez = smeta(obrazec);
    assert.match(bez, /<body>/); // у большого листа на body класса нет
    for (const sheet of musor) assert.equal(smeta({ ...obrazec, sheet }), bez, `sheet = ${JSON.stringify(sheet) ?? "undefined"}`);
    // проверка не пустая: настоящие значения страницу меняют
    for (const sheet of ["compact", "pc"]) assert.notEqual(smeta({ ...obrazec, sheet }), bez, sheet);
  }
});

test("форматы листа структурно: «ПК» — @page 595pt × 842pt, короткая смета (1–4 позиции) одной страницей .one без связки .tail, длинная (30) без .one и с одной связкой; compact — 420pt × 595pt, класс cp у body, pc нет", () => {
  const chisloSlov = (html, slovo) => skolko(BEZ_STILEI(html), slovo);
  for (const n of [1, 2, 3, 4]) {
    const html = smeta({ items: pozicii(n), sheet: "pc" });
    assert.match(html, /@page \{\s*size: 595pt 842pt;\s*margin: 12mm 0 16mm 0;/, `ПК, ${n}`);
    assert.match(html, /@page one \{\s*margin: 0;/, `ПК, ${n}: страницы one нет`);
    assert.equal(chisloSlov(html, '<div class="one">'), 1, `ПК, ${n} поз.: нет страницы .one`);
    assert.equal(chisloSlov(html, 'class="tail"'), 0, `ПК, ${n} поз.: связка .tail осталась`);
    assert.match(html, /<body class="cp pc">/);
    // на странице .one лежит всё: шапка, клиент, карточки, расчёт, срок КП и нижняя плитка
    const odna = blokDiv(BEZ_STILEI(html), '<div class="one">');
    assert.ok(odna, `ПК, ${n}: .one не закрыт`);
    for (const chast of ['class="bleed"', "blk-client", 'class="cd"', "blk-totals", 'class="tb-note', 'class="tb"']) assert.ok(odna.includes(chast), `ПК, ${n}: в .one нет ${chast}`);
    assert.equal(skolko(odna, 'class="cd"'), n);
  }
  const dlinnaya = smeta({ items: pozicii(30), sheet: "pc" });
  assert.match(dlinnaya, /@page \{\s*size: 595pt 842pt;/);
  assert.equal(chisloSlov(dlinnaya, '<div class="one">'), 0);
  assert.equal(chisloSlov(dlinnaya, 'class="tail"'), 1);
  assert.match(dlinnaya, /<body class="cp pc">/);

  for (const n of [1, 4, 30]) {
    const kompakt = smeta({ items: pozicii(n), sheet: "compact" });
    assert.match(kompakt, /@page \{\s*size: 420pt 595pt;\s*margin: 12mm 0 16mm 0;/);
    assert.doesNotMatch(kompakt, /size: 595pt 842pt|@page one/);
    assert.match(kompakt, /<body class="cp">/);
    assert.doesNotMatch(kompakt, /<body class="cp pc"|<body class="[^"]*\bpc\b/);
    assert.equal(chisloSlov(kompakt, '<div class="one">'), 0, "у компактного листа страницы .one нет");
    assert.equal(chisloSlov(kompakt, 'class="tail"'), 1);
  }
  const bolshoy = smeta({ items: pozicii(4) });
  assert.match(bolshoy, /@page \{\s*size: 420pt 595pt;/);
  assert.match(bolshoy, /<body>/);
  // везде один @page без имени и один размер листа; div'ы закрыты
  for (const sheet of FORMATY_LISTA) for (const n of [1, 4, 30]) {
    const html = smeta({ items: pozicii(n), sheet });
    assert.equal((html.match(/@page\s*\{/g) || []).length, 1, `${sheet}, ${n}`);
    assert.equal((html.match(/size:\s*\d+pt \d+pt/g) || []).length, 1, `${sheet}, ${n}`);
    const razmetka = BEZ_STILEI(html);
    assert.equal((razmetka.match(/<div[\s>]/g) || []).length, (razmetka.match(/<\/div>/g) || []).length, `${sheet}, ${n}: div'ы не закрыты`);
  }
});

// --- защита (XSS) нового вида: пользовательский текст — в каждом поле, во всех трёх форматах ---

// Тело, где КАЖДОЕ пользовательское поле — строка s; daty — validUntil, createdDay, printDay
function zapolnennoeTelo(s, daty = { validUntil: s, createdDay: s, printDay: s }) {
  return {
    clientData: { appealId: `#7${s}`, clientName: s, phone: s, city: s, address: s },
    items: [
      { ...POZICIYA, id: "a", productLabel: s, materialName: s, room: s },
      { ...POZICIYA, id: "b", productLabel: s, materialName: s, room: s, groupId: "g1" },
      { ...POZICIYA, id: "c", productLabel: s, materialName: s, groupId: "g1", price: 12000 },
    ],
    groups: [{ id: "g1", name: s, label: s }],
    cityContext: { name: s, siteHost: "istra.zhalyuzi-sunray.ru" },
    ...daty,
  };
}
const CHISTYE_DATY = { validUntil: "2026-10-22", createdDay: "2026-09-12", printDay: "2026-10-17" };
const OPASNYE_STROKI = [
  // vShapke — как город попадает в подзаголовок шапки (режется до 18 знаков, экранируется); vPodvale — как в CSS-строку подвала (кавычка, «<», «>» — CSS-кодами)
  { imya: "тег с обработчиком и скрипт", s: '"><img src=x onerror=alert(1)><script>alert(1)</script>', vShapke: "<i>Объект</i><span>&quot;&gt;&lt;img src=x", vPodvale: "\\22 \\3e \\3c img src=x" },
  { imya: "закрытие стиля", s: "</style><script>alert(2)</script>", vShapke: "<i>Объект</i><span>&lt;/style&gt;&lt;script&gt;", vPodvale: "\\3c /style\\3e \\3c script\\3e " },
];

test("защита: опасная строка в КАЖДОМ пользовательском поле (клиент, телефон, город, адрес, номер, название, материал, помещение, группа, город объекта, даты) — big, compact и pc без сырых тегов, второго <style> и разрыва строки подвала", () => {
  for (const { imya, s, vShapke, vPodvale } of OPASNYE_STROKI) {
    for (const sheet of FORMATY_LISTA) {
      const kuda = `${imya}, ${sheet}`;
      const html = smeta({ ...zapolnennoeTelo(s), sheet });
      const razmetka = BEZ_STILEI(html);
      assert.ok(!html.includes("<img src=x onerror"), kuda);
      assert.ok(!html.includes("<script"), kuda); // в том числе «<script>alert»
      assert.ok(!html.includes("</style><script"), kuda);
      assert.equal(skolko(html, "<style"), 1, `${kuda}: второй <style`);
      assert.equal(skolko(html, "</style>"), 1, `${kuda}: второй </style>`);
      // новых тегов нет: набор тегов страницы с опасными строками — часть набора чистой сметы того же формата и того же строения
      const chistye = tegi(BEZ_STILEI(smeta({ ...zapolnennoeTelo("Тест", CHISTYE_DATY), sheet })));
      for (const teg of tegi(razmetka)) assert.ok(chistye.has(teg), `${kuda}: появился тег <${teg}>`);
      for (const teg of razmetka.match(/<[^>]*>/g)) assert.ok(!/\son[a-z]+\s*=/i.test(teg), `${kuda}: обработчик в теге ${teg.slice(0, 80)}`);
      // текст попал в страницу экранированным (проверка не пустая): имя клиента целиком, город — в подзаголовке шапки и в метке над итогом
      assert.ok(razmetka.includes(`<div class="cl-name">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</div>`), `${kuda}: имя клиента`);
      assert.ok(razmetka.includes(vShapke), `${kuda}: город в шапке`);
      assert.ok(razmetka.includes(`<i>Объект</i><b>${vShapke.slice("<i>Объект</i><span>".length)}`), `${kuda}: город в метке`);
      // подвал: строка content: "…" закрыта где надо, опасных знаков в ней нет, город в ней — CSS-кодами (\22 — кавычка, \3c — «<», \3e — «>»)
      const podval = levyPodval(html);
      assert.ok(podval !== null, `${kuda}: строка подвала разорвана`);
      assert.match(podval, /^SUNRAY · КП №/);
      assert.ok(!/[<>&"'\n\r]/.test(podval), `${kuda}: в строке подвала опасный знак: ${podval}`);
      const gorodVPodvale = podval.split(" · Объект: ")[1];
      assert.ok(gorodVPodvale && gorodVPodvale.startsWith(vPodvale), `${kuda}: город в подвале: ${podval}`);
      assert.equal(skolko(html, 'content: "Лист " counter(page) " из " counter(pages);'), 1, `${kuda}: правая половина подвала`);
    }
  }
});

// --- числа и пустая смета ---

test("числа: в HTML big, compact и pc нет NaN, Infinity и undefined — при 1, 2, 30 и 400 позициях, нулевых и отрицательных ценах и количествах, скидке 100%, НДС, группах, акции и монтаже", () => {
  const raznye = (n) => pozicii(n, (i) => ({
    price: [-500, 0, 12345, 1e9][i % 4],
    quantity: [0, 1, 3, -2][(i + 1) % 4],
    discountPercent: [0, 10, 100, 0][(i + 2) % 4],
    vatEnabled: i % 5 === 0,
    ...(i % 7 === 0 ? { priceMode: "unit" } : {}),
    ...(i % 3 === 1 ? { groupId: "g1" } : i % 3 === 2 ? { groupId: "g2" } : {}),
  }));
  for (const sheet of FORMATY_LISTA) {
    for (const n of [1, 2, 30, 400]) {
      const html = smeta({
        items: raznye(n), groups: [{ id: "g1", name: "А" }, { id: "g2", name: "Б" }], promoDiscount: 90, promoFromQty: 20, vatIncluded5: true,
        montage: { mode: "sum", amount: 1e9 }, cityContext: GOROD_ISTRA, sheet,
      });
      const chistoe = BEZ_DATA(html);
      assert.ok(!/NaN|Infinity|undefined|\[object/.test(chistoe), `${sheet}, ${n} поз.: ${chistoe.match(/.{0,30}(NaN|Infinity|undefined|\[object).{0,30}/)?.[0]}`);
      assert.equal(skolko(BEZ_STILEI(html), 'class="blk blk-card'), n, `${sheet}, ${n} поз.: карточек столько же, сколько позиций`);
    }
  }
});

test("пустой items: шаблон не падает ни в одном формате — карточек нет, «Количество позиций» 0, «Итого к оплате» 0 ₽; compact и pc ведут себя как big", () => {
  for (const sheet of FORMATY_LISTA) {
    const html = smeta({ items: [], sheet });
    const razmetka = BEZ_STILEI(html);
    assert.equal(skolko(razmetka, 'class="blk blk-card'), 0, sheet);
    assert.equal(skolko(razmetka, "blk-totals"), 1, sheet);
    assert.match(razmetka, /Количество позиций<\/span>\s*<span class="t-value">0\sшт\.<\/span>/, sheet);
    assert.equal(itogo(html), "0 ₽", sheet);
    assert.ok(!/NaN|Infinity|undefined/.test(BEZ_DATA(html)), sheet);
  }
});

test("отладки в странице нет: при CP_DEBUG=1 (в окружении и до загрузки шаблона, и после) в HTML big, compact и pc нет «CPDBG» и data-est", () => {
  const put = require.resolve("./shablon");
  const staryy = require.cache[put];
  const bylo = process.env.CP_DEBUG;
  process.env.CP_DEBUG = "1";
  delete require.cache[put];
  try {
    const svezhiy = require("./shablon"); // шаблон, загруженный уже с CP_DEBUG=1: переменную, прочитанную при загрузке, тест тоже увидит
    for (const modul of [{ buildHtml }, svezhiy]) {
      for (const sheet of FORMATY_LISTA) {
        for (const items of [[POZICIYA], pozicii(3), pozicii(30)]) {
          const html = modul.buildHtml({ clientData: { appealId: "#7", clientName: "Иванов" }, items: dozapolnitPozicii(items), sheet, cityContext: GOROD_ISTRA, printDay: "2026-10-17" });
          assert.ok(!html.includes("CPDBG"), `${sheet}: CPDBG`);
          assert.ok(!/data-est/.test(html), `${sheet}: data-est`);
          assert.ok(!html.includes("CP_DEBUG"), `${sheet}: CP_DEBUG`);
        }
      }
    }
  } finally {
    if (bylo === undefined) delete process.env.CP_DEBUG; else process.env.CP_DEBUG = bylo;
    if (staryy) require.cache[put] = staryy; else delete require.cache[put];
  }
});

// --- раскладка компактного листа planKompakta ---

// Эталон раскладки по описанию planKompakta: листы тела — следующая карточка, не влезшая в остаток листа, открывает новый; связка — последние k карточек вместе с расчётом, плашками, сроком
// и плиткой; берётся k с наименьшим числом листов тела, при равенстве меньшее. Эталон проверяет АЛГОРИТМ, поэтому числа берёт из экспорта шаблона (CP_PL_H, запасы, поля CP_A5 / CP_PC): перекалибровка
// не делает его красным. Саму КАЛИБРОВКУ держат литералы: тест «числа калибровки листа» и граничные тесты ниже (ровно на границе — да, на 1 px выше — нет).
const summa = (a) => a.reduce((x, y) => x + y, 0);
function listyTela(hs, clientH, G) {
  let listy = 1, ostatok = G.FIRST_FIELD - (CP_PL_H + 8) - (clientH + 8) - 4;
  for (const h of hs) { if (h > ostatok) { listy++; ostatok = G.NEXT_FREE; } ostatok -= h; }
  return listy;
}
function etalonPlana({ heights, clientH, tailBase }, G) {
  const n = heights.length;
  let k = 0, luchshiy = Infinity;
  for (let t = 1; t <= n - 1; t++) {
    if (summa(heights.slice(n - t)) + tailBase > G.TAIL - CP_TAIL_SAFE - CP_TAIL_SAFE_PER_CARD * t) break;
    const listy = listyTela(heights.slice(0, n - t).map((h) => h * CP_PACK_SAFE), clientH, G);
    if (listy < luchshiy) { luchshiy = listy; k = t; }
  }
  return { k, onePage: G.PC && CP_PL_H + 8 + clientH + 8 + summa(heights) + tailBase <= G.ONE - CP_ONE_SAFE };
}
// Детерминированные «случайные» числа: один и тот же прогон каждый раз
function sluchaynye(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test("числа калибровки листа: запас связки 8 + 18 на карточку, запас «одного листа» 40, запас листов тела 1,03, шапка 144 px; A5 — поле 733 / 683, связка 747; ПК — 1062 / 1012, связка 1076, лист 1121", () => {
  // 18 px на карточку и 40 px — запас на недооценку estCardCompact на строку (12–18 px, независимая проверка 20.10.2026); было 2 и 24 — связка A5 рвалась на 4 из 10 состязательных тел
  assert.equal(CP_TAIL_SAFE, 8);
  assert.equal(CP_TAIL_SAFE_PER_CARD, 18);
  assert.equal(CP_ONE_SAFE, 40);
  assert.equal(CP_PACK_SAFE, 1.03);
  assert.equal(CP_PL_H, 144);
  const kalibrovka = {
    A5: [CP_A5, { PC: false, FIRST_FIELD: 733, NEXT_FREE: 683, TAIL: 747, ONE: 0 }],
    "ПК": [CP_PC, { PC: true, FIRST_FIELD: 1062, NEXT_FREE: 1012, TAIL: 1076, ONE: 1121 }],
  };
  for (const [kuda, [G, ozhidaemoe]] of Object.entries(kalibrovka)) {
    for (const pole of Object.keys(ozhidaemoe)) assert.equal(G[pole], ozhidaemoe[pole], `${kuda}: ${pole}`);
  }
});

test("раскладка planKompakta: пустой список карточек — {k: 0, onePage: false} (A5 всегда; ПК — если шапка, клиент и связка не влезают на лист) и без исключения", () => {
  assert.deepEqual(planKompakta({ heights: [], clientH: 80, tailBase: 400, G: CP_A5 }), { k: 0, onePage: false });
  assert.deepEqual(planKompakta({ heights: [], clientH: 0, tailBase: 0, G: CP_A5 }), { k: 0, onePage: false });
  assert.deepEqual(planKompakta({ heights: [], clientH: 80, tailBase: 2000, G: CP_PC }), { k: 0, onePage: false });
  // ПК: пустая шапка + клиент + обычная связка (152 + 88 + 400 = 640 ≤ 1081) на одном листе помещаются
  assert.deepEqual(planKompakta({ heights: [], clientH: 80, tailBase: 400, G: CP_PC }), { k: 0, onePage: true });
});

test("раскладка planKompakta: одна карточка — k = 0 (она остаётся с шапкой); две малых — k = 1; три малых — тоже 1 (листов поровну — меньшее k)", () => {
  for (const G of [CP_A5, CP_PC]) {
    for (const h of [1, 100, 500, 5000]) assert.equal(planKompakta({ heights: [h], clientH: 80, tailBase: 400, G }).k, 0, `одна карточка ${h}`);
    assert.equal(planKompakta({ heights: [100, 100], clientH: 80, tailBase: 400, G }).k, 1);
    assert.equal(planKompakta({ heights: [100, 100, 100], clientH: 80, tailBase: 400, G }).k, 1);
  }
});

test("раскладка planKompakta: хвост больше связки — одна последняя карточка в связку не влезает (A5: 747 − 8 − 18 = 721 px, ПК: 1076 − 8 − 18 = 1050) — k = 0 при любом n ≥ 2; ровно на границе k = 1, на 1 px выше 0", () => {
  for (const [G, granica] of [[CP_A5, 721], [CP_PC, 1050]]) {
    const tailBase = 400;
    const kuda = G.PC ? "ПК" : "A5";
    assert.equal(planKompakta({ heights: [100, granica - tailBase], clientH: 80, tailBase, G }).k, 1, `${kuda}: ровно на границе`);
    assert.equal(planKompakta({ heights: [100, granica - tailBase + 1], clientH: 80, tailBase, G }).k, 0, `${kuda}: на 1 px выше`);
    assert.equal(planKompakta({ heights: [100, 100, 100, 100, 5000], clientH: 80, tailBase, G }).k, 0, `${kuda}: огромная последняя`);
    assert.equal(planKompakta({ heights: [5000, 5000, 100], clientH: 80, tailBase, G }).k, 1, `${kuda}: огромные ранние карточки в связку не просятся`);
  }
  // две карточки в связке: на каждую карточку запас растёт ещё на 18 px (A5: 747 − 8 − 2 × 18 = 703). Тело из четырёх карточек по 119 px — два листа, из трёх — один, поэтому две карточки в связке выгоднее одной
  // и k = 2, пока связка (119 + последняя + 300) не выше 703: последняя 284 — ровно 703, 285 — на 1 px выше, и остаётся одна карточка
  assert.equal(planKompakta({ heights: [119, 119, 119, 119, 284], clientH: 80, tailBase: 300, G: CP_A5 }).k, 2, "A5: две карточки, связка ровно 703");
  assert.equal(planKompakta({ heights: [119, 119, 119, 119, 285], clientH: 80, tailBase: 300, G: CP_A5 }).k, 1, "A5: связка 704 > 703 — две карточки уже не влезают");
  // первая карточка всегда остаётся в теле (с шапкой): k не больше n − 1, даже когда все три влезли бы в связку (480 + 60 + 60 + 50 = 650 ≤ 747 − 8 − 3 × 18 = 685), а тело из одной
  // карточки в 480 px (× 1,03 = 494 > 489) считалось бы за два листа; без карточек в теле лист был бы один — но такого k нет
  assert.equal(planKompakta({ heights: [480, 60, 60], clientH: 80, tailBase: 50, G: CP_A5 }).k, 1);
});

test("раскладка planKompakta: листы тела считаются с запасом 3 % на оценку — тело из четырёх карточек по 118 px (4 × 118 × 1,03 = 486,2 ≤ 489 — поле первого листа A5) ещё один лист, по 119 px (490,3 > 489) уже два, и в связку уходят две карточки, а не одна", () => {
  // поле первого листа A5: 733 − (144 + 8) − (80 + 8) − 4 = 489
  const plan = (h) => planKompakta({ heights: [h, h, h, h, h], clientH: 80, tailBase: 300, G: CP_A5 });
  assert.equal(plan(118).k, 1);
  assert.equal(plan(119).k, 2);
  assert.equal(plan(120).k, 2);
  assert.equal(plan(100).k, 1);
});

test("раскладка planKompakta: onePage у ПК — вся смета (шапка 144 + 8, клиент + 8, карточки, связка) не выше 1121 − 40 = 1081 px: ровно на границе истина, на 1 px выше ложь; у A5 всегда ложь", () => {
  const one = (heights, clientH = 80, tailBase = 400, G = CP_PC) => planKompakta({ heights, clientH, tailBase, G }).onePage;
  // 152 + 80 + 8 + h + 400 = 1081 → h = 441
  assert.equal(one([441]), true);
  assert.equal(one([442]), false);
  assert.equal(one([200, 150, 91]), true);
  assert.equal(one([200, 150, 92]), false);
  assert.equal(one([440], 81), true, "клиент входит в сумму");
  assert.equal(one([441], 81), false);
  assert.equal(one([440], 80, 401), true, "связка входит в сумму");
  assert.equal(one([441], 80, 401), false);
  for (const heights of [[], [1], [441], [100, 100], [5000]]) assert.equal(one(heights, 0, 0, CP_A5), false, `A5: ${JSON.stringify(heights)}`);
  // решает флаг PC, а не высота листа: у листа не-ПК onePage ложь, даже если высота «листа целиком» задана
  assert.equal(one([100], 80, 400, { ...CP_A5, ONE: 1121 }), false);
  // k от onePage не зависит
  assert.deepEqual(planKompakta({ heights: [100, 100], clientH: 80, tailBase: 400, G: CP_PC }), { k: 1, onePage: true });
});

test("раскладка planKompakta совпадает с эталоном на 4000 случайных тел (A5 и ПК, 0–14 карточек); эталонные листы тела не убывают при росте высот", () => {
  const rnd = sluchaynye(20261020);
  const videl = { k0: 0, kBolshe0: 0, odna: 0, neOdna: 0 };
  for (let i = 0; i < 4000; i++) {
    const G = i % 2 ? CP_PC : CP_A5;
    const n = Math.floor(rnd() * 15);
    const heights = Array.from({ length: n }, () => 40 + Math.floor(rnd() * 230));
    const clientH = 80 + Math.floor(rnd() * 60);
    const tailBase = 150 + Math.floor(rnd() * (G.PC ? 800 : 500));
    const ozhidaemoe = etalonPlana({ heights, clientH, tailBase }, G);
    const poluchili = planKompakta({ heights, clientH, tailBase, G });
    assert.deepEqual(poluchili, ozhidaemoe, JSON.stringify({ pc: G.PC, heights, clientH, tailBase }));
    videl[poluchili.k ? "kBolshe0" : "k0"]++;
    videl[poluchili.onePage ? "odna" : "neOdna"]++;
    // листы тела (эталон) при росте высот не убывают
    const vyshe = heights.map((h) => (rnd() < 0.4 ? h + Math.floor(rnd() * 60) : h));
    assert.ok(listyTela(vyshe, clientH, G) >= listyTela(heights, clientH, G), JSON.stringify({ heights, vyshe, clientH }));
  }
  for (const [chto, skolkoRaz] of Object.entries(videl)) assert.ok(skolkoRaz >= 100, `случаев «${chto}» слишком мало (${skolkoRaz}): проверка пустая`);
});

test("раскладка planKompakta, свойства: выбранное k всегда влезает в связку; рост последней карточки или связки k не увеличивает; onePage при росте любых высот, клиента и связки только гаснет", () => {
  const rnd = sluchaynye(7);
  for (let i = 0; i < 1500; i++) {
    const G = i % 2 ? CP_PC : CP_A5;
    const n = 2 + Math.floor(rnd() * 10);
    const heights = Array.from({ length: n }, () => 60 + Math.floor(rnd() * 120));
    const clientH = 80 + Math.floor(rnd() * 40);
    const tailBase = 250 + Math.floor(rnd() * 250);
    const plan = (hs, c = clientH, t = tailBase) => planKompakta({ heights: hs, clientH: c, tailBase: t, G });
    const { k } = plan(heights);
    assert.ok(k >= 0 && k <= n - 1, `k = ${k} при n = ${n}`);
    if (k > 0) assert.ok(summa(heights.slice(n - k)) + tailBase <= G.TAIL - CP_TAIL_SAFE - CP_TAIL_SAFE_PER_CARD * k, `связка из ${k} карточек не влезает: ${JSON.stringify({ pc: G.PC, heights, clientH, tailBase })}`);
    let kProshloe = Infinity, kProshloeT = Infinity, odnaProshloe = true;
    for (let dop = 0; dop <= 800; dop += 40) {
      const kNovoe = plan([...heights.slice(0, -1), heights[n - 1] + dop]).k;
      assert.ok(kNovoe <= kProshloe, `рост последней карточки на ${dop} увеличил k: ${kProshloe} → ${kNovoe}`);
      kProshloe = kNovoe;
      const kT = plan(heights, clientH, tailBase + dop).k;
      assert.ok(kT <= kProshloeT, `рост связки на ${dop} увеличил k: ${kProshloeT} → ${kT}`);
      kProshloeT = kT;
      const odna = plan(heights.map((h) => h + dop / 10), clientH + dop / 10, tailBase + dop / 10).onePage;
      assert.ok(!(odna && !odnaProshloe), `рост высот на ${dop / 10} вернул onePage`);
      odnaProshloe = odna;
    }
  }
});

// --- оценка строк: заглавные буквы шире строчных ---

test("оценка строк estLinesM: заглавные слова дают не меньше строк, чем строчные того же числа знаков; «ЖАЛЮЗИ ГОРИЗОНТАЛЬНЫЕ» в колонке 22 знака — две строки, «жалюзи горизонтальные» — одна", () => {
  assert.equal(estLinesM("жалюзи горизонтальные", 22), 1);
  assert.equal(estLinesM("ЖАЛЮЗИ ГОРИЗОНТАЛЬНЫЕ", 22), 2);
  assert.equal(estLinesM("", 22), 1);
  assert.equal(estLinesM(undefined, 22), 1);
  assert.equal(estLinesM("Ш".repeat(50), 22), 3, "слово длиннее строки переносится");
  const teksty = [
    "жалюзи горизонтальные", "рулонная штора мини", "шторы плиссе для мансардных окон", "ткань блэкаут жемчуг", "жалюзи вертикальные тканевые белые", "шторы день-ночь зебра",
    "шшшшшшшшшш шшшшшшшшшш", "ммммммммм ююююююююю", "ыыыыыыыыыыыыыыыыыыыыы", "щщщщщщ ъъъъъъ жжжжжж фффффф", "римская штора на заказ из натурального льна",
  ];
  for (const perLine of [10, 22, 30, 40, 62]) {
    for (const tekst_ of teksty) {
      assert.ok(estLinesM(tekst_.toUpperCase(), perLine) >= estLinesM(tekst_, perLine), `${tekst_} в колонке ${perLine}`);
    }
  }
  // карточка с заглавным названием не ниже строчной, а «ЖАЛЮЗИ ГОРИЗОНТАЛЬНЫЕ 1 шт.» в колонке 30 знаков A5 — на строку выше (18 + 2 × 17,7 против 18 + 22)
  const num = (n) => n.toLocaleString("ru-RU");
  const rub = (n) => `${num(n)} ₽`;
  const vysota = (productLabel) => estCardCompact({ productLabel, quantity: 1, price: 1000 }, { hasAnyDiscount: false, hasAnyVat: false, num, rub, G: CP_A5 });
  assert.ok(Math.abs(vysota("жалюзи горизонтальные") - 40) < 1e-9);
  assert.ok(Math.abs(vysota("ЖАЛЮЗИ ГОРИЗОНТАЛЬНЫЕ") - 53.4) < 1e-9);
});

// --- город объекта: gorodObekta, страница, подвал ---

test("город объекта gorodObekta: нет cityContext, null, число, строка, массив, {} , не строка в name, имя из одних пробелов — города нет (name ''), хост основной", () => {
  for (const vhod of [
    undefined, null, 0, 5, true, "Истра", ["Истра"], [], {}, { name: 5 }, { name: null }, { name: [] }, { name: {} }, { name: "" }, { name: "   " }, { name: "\n\t  " },
    { siteHost: "istra.zhalyuzi-sunray.ru" }, { name: "  ", siteHost: "istra.zhalyuzi-sunray.ru" }, { name: "", siteHost: "istra.zhalyuzi-sunray.ru" },
  ]) assert.deepEqual(gorodObekta(vhod), { name: "", host: OSNOVNOY_SAYT }, JSON.stringify(vhod) ?? "undefined");
});

test("город объекта: пробелы по краям убираются, повторные — в один; до 18 знаков — как есть; длиннее — одна общая строка до 18 знаков с «…»: резка по границе слова или дефиса, висячие слова до двух букв уходят", () => {
  const imya = (name) => gorodObekta({ name }).name;
  assert.equal(imya("  Красная   Пахра "), "Красная Пахра");
  assert.equal(imya("Лосино-Петровский"), "Лосино-Петровский"); // 17 знаков — самое длинное название справочника
  assert.equal(imya("Электрозаводская"), "Электрозаводская");
  assert.equal(imya("А".repeat(18)), "А".repeat(18));
  assert.equal(imya("Красная Пахра-на-Оке и далее"), "Красная Пахра…");
  assert.equal(imya("Старая Купавна и Ногинск"), "Старая Купавна…"); // висячее «и» убрано
  assert.equal(imya("Сергиево-Посадский район"), "Сергиево…"); // режем по дефису
  assert.equal(imya("Ростов-на-Дону-и-окрестности"), "Ростов-на-Дону…");
  assert.equal(imya("Москва Сити Центр Юг Запад"), "Москва Сити Центр…"); // 18-й знак — пробел: границы слова совпали с границей строки
  assert.equal(imya("А".repeat(19)), `${"А".repeat(17)}…`); // слово без границ — жёсткий рез: 17 знаков и «…»
  assert.equal(imya("Ж".repeat(30)), `${"Ж".repeat(17)}…`);
  assert.equal(imya("😀".repeat(20)), `${"😀".repeat(17)}…`); // считаем знаки, а не кодовые единицы
  // что бы ни пришло: на листе не больше 18 знаков, обрезанное кончается «…» сразу за буквой, а начало — начало присланного имени
  for (const name of [
    "Красная Пахра-на-Оке и далее", "Старая Купавна и Ногинск", "Нижний Новгород Верхний", "Сергиев Посад и окрестные деревни", "Орехово-Зуевский городской округ",
    "Новая Москва Троицк", "Московская область Одинцовский район", "Ак Бар-Сунгуровское сельское", "А".repeat(40), "Ab cd ef gh ij kl mn op qr st", "1234567890 1234567890 1234567890",
  ]) {
    const norma = name.replace(/\s+/g, " ").trim();
    const pokazano = imya(name);
    assert.ok(Array.from(pokazano).length <= 18, `${name}: ${pokazano}`);
    assert.ok(pokazano.endsWith("…") && !/[\s-]…$/.test(pokazano), `${name}: ${pokazano}`);
    assert.ok(norma.startsWith(pokazano.slice(0, -1)), `${name}: ${pokazano}`);
  }
});

test("город объекта: хост сайта — только zhalyuzi-sunray.ru и его поддомен из белого списка SITE_HOST_RE; чужой, составной, с протоколом, пробелом, в верхнем регистре, слишком длинный или не строка — основной сайт", () => {
  const host = (siteHost) => gorodObekta({ name: "Истра", siteHost }).host;
  const horoshie = ["istra.zhalyuzi-sunray.ru", "zhalyuzi-sunray.ru", "a.zhalyuzi-sunray.ru", "a-b-1.zhalyuzi-sunray.ru", `${"a".repeat(40)}.zhalyuzi-sunray.ru`];
  for (const h of horoshie) { assert.equal(host(h), h); assert.equal(SITE_HOST_RE.test(h), true, h); }
  const plohie = [
    "evil.com", "a.zhalyuzi-sunray.ru.evil.com", "https://istra.zhalyuzi-sunray.ru", "istra.zhalyuzi-sunray.ru ", " istra.zhalyuzi-sunray.ru", "ISTRA.ZHALYUZI-SUNRAY.RU", "Istra.zhalyuzi-sunray.ru",
    `${"a".repeat(41)}.zhalyuzi-sunray.ru`, "a.b.zhalyuzi-sunray.ru", "istra.zhalyuzi-sunray.ru\n", "istra.zhalyuzi-sunray.ru:443", "istra.zhalyuzi-sunray.ru/", "istra.zhalyuzi-sunray.ru/x",
    "xzhalyuzi-sunray.ru", ".zhalyuzi-sunray.ru", "zhalyuzi-sunray.ru.", "istra.zhalyuzi-sunray.rux", "istra_1.zhalyuzi-sunray.ru", "evil.com#.zhalyuzi-sunray.ru", "evil.com/.zhalyuzi-sunray.ru",
    "evil.com?.zhalyuzi-sunray.ru", "evil.com\\.zhalyuzi-sunray.ru", "istra.zhalyuzi-sunray.ru\u0000", "", 5, null, undefined, {}, [], ["istra.zhalyuzi-sunray.ru"],
  ];
  for (const h of plohie) {
    assert.equal(host(h), OSNOVNOY_SAYT, `siteHost = ${JSON.stringify(h) ?? "undefined"}`);
    if (typeof h === "string") assert.equal(SITE_HOST_RE.test(h), false, `SITE_HOST_RE.test(${JSON.stringify(h)})`); // не строки RegExp.test приводит к строке сам: массив из одного хоста стал бы им, поэтому тип проверяет код
  }
  assert.equal(SITE_HOST_RE.global, false, "с флагом g test() помнил бы lastIndex между запросами");
  // хост без города не нужен
  assert.equal(gorodObekta({ name: "", siteHost: "istra.zhalyuzi-sunray.ru" }).host, OSNOVNOY_SAYT);
  // хост из кармана сайта доходит до страницы только через белый список: «evil.com» в страницу не попадает ни в одном формате
  for (const sheet of FORMATY_LISTA) {
    const html = smeta({ cityContext: { name: "Истра", siteHost: 'evil.com"><script>alert(1)</script>' }, sheet });
    assert.ok(!html.includes("evil.com") && !html.includes("<script"), sheet);
    assert.ok(BEZ_STILEI(html).includes(`<a href="https://${OSNOVNOY_SAYT}/">${OSNOVNOY_SAYT}</a>`), sheet);
  }
});

test("город в странице: «Объект Истра» в шапке (подзаголовок), в метке над итогом и в подвале «SUNRAY · КП №… · Объект: Истра», ссылка сайта — на поддомен города; во всех форматах, остальная разметка та же", () => {
  for (const sheet of FORMATY_LISTA) {
    const html = smeta({ cityContext: GOROD_ISTRA, sheet });
    const razmetka = BEZ_STILEI(html);
    assert.match(razmetka, /<div class="pl-hb"><h1 class="pl-h">Коммерческое предложение<\/h1><div class="pl-city"><svg class="city-ico"[^>]*>[\s\S]*?<\/svg><i>Объект<\/i><span>Истра<\/span><\/div><\/div>/, `${sheet}: шапка`);
    assert.match(razmetka, /<div class="tb-vlab tb-vlab-city"><span>Срок предложения<\/span><span class="tb-city"><svg class="city-ico"[^>]*>[\s\S]*?<\/svg><i>Объект<\/i><b>Истра<\/b><\/span><\/div>/, `${sheet}: метка над итогом`);
    assert.equal(levyPodval(html), "SUNRAY · КП №09784 · Объект: Истра", `${sheet}: подвал`);
    assert.ok(html.includes('content: "SUNRAY · КП №09784 · Объект: Истра";'), sheet);
    assert.equal(skolko(razmetka, "Объект"), 2, `${sheet}: «Объект» в разметке (шапка и метка)`);
    assert.equal(skolko(razmetka, "<i>Объект</i>"), 2, sheet);
    assert.ok(razmetka.includes('<div class="tb-ln"><a href="https://istra.zhalyuzi-sunray.ru/">istra.zhalyuzi-sunray.ru</a></div>'), `${sheet}: ссылка сайта города`);
    assert.ok(!razmetka.includes(`href="https://${OSNOVNOY_SAYT}/"`), `${sheet}: осталась ссылка на основной сайт`);
    // CSS города: правила есть, подвал шире слева (76 % / 24 %), ПК — город на линии даты
    for (const pravilo of [".city-ico {", ".pl-hb {", ".pl-city {", ".tb-vlab-city {", ".tb-city {"]) assert.ok(html.includes(pravilo), `${sheet}: нет CSS ${pravilo}`);
    assert.ok(html.includes(".pc .pl-hb { padding-bottom: 5px; }"), `${sheet}: правило ПК для шапки города`);
    assert.equal(shirinaPodvala(html, "bottom-left"), "calc(76% - 10mm)", sheet);
    assert.equal(shirinaPodvala(html, "bottom-right"), "calc(24% - 10mm)", sheet);
    // ничего лишнего: если свернуть три места города обратно, разметка равна разметке без города (связка и страница .one считаются как прежде)
    const svernuto = razmetka
      .replace(/<div class="pl-hb">(<h1 class="pl-h">[^<]*<\/h1>)<div class="pl-city">[\s\S]*?<\/div><\/div>/, "$1")
      .replace(/<div class="tb-vlab tb-vlab-city"><span>Срок предложения<\/span><span class="tb-city">[\s\S]*?<\/span><\/div>/, '<div class="tb-vlab">Срок предложения</div>')
      .replaceAll("istra.zhalyuzi-sunray.ru", OSNOVNOY_SAYT);
    assert.equal(svernuto, BEZ_STILEI(smeta({ sheet })), `${sheet}: разметка с городом отличается не только городом`);
    // реквизиты ИП не менялись: ИНН, ОГРНИП, телефон, почта — как были
    const rekvizity = blokDiv(razmetka, '<div class="tb-req">');
    for (const stroka_ of ["Индивидуальный предприниматель", "Журович-Миронова Дарья Васильевна", "<i>ИНН</i> 910502074977", "<i>ОГРНИП</i> 321911200058121", '<a href="tel:+79998107717">+7 (999) 810-77-17</a>', '<a href="mailto:sunray-zhalyuzi@yandex.ru">sunray-zhalyuzi@yandex.ru</a>']) {
      assert.ok(rekvizity.includes(stroka_), `${sheet}: реквизит ${stroka_}`);
    }
  }
});

test("город в странице: без номера обращения подвала нет, а город в шапке и в метке есть (подвал остаётся узким 50 / 50); без города — ни разметки, ни CSS города, строка сайта основная", () => {
  for (const sheet of FORMATY_LISTA) {
    const bezNomera = smeta({ clientData: { clientName: "Без номера" }, cityContext: GOROD_ISTRA, sheet });
    assert.equal(levyPodval(bezNomera), "", sheet);
    assert.match(BEZ_STILEI(bezNomera), /<div class="pl-city">[\s\S]*<i>Объект<\/i><span>Истра<\/span>/);
    assert.match(BEZ_STILEI(bezNomera), /<span class="tb-city">[\s\S]*<i>Объект<\/i><b>Истра<\/b>/);
    assert.ok(!bezNomera.includes("calc(76%") && !bezNomera.includes("calc(24%"), `${sheet}: подвал расширен без подвала`);
    assert.equal(shirinaPodvala(bezNomera, "bottom-left"), "calc(50% - 10mm)");

    const bezGoroda = smeta({ sheet });
    for (const sled of ["pl-hb", "pl-city", "tb-vlab-city", "tb-city", "city-ico", "Объект", ".pc .pl-hb", "calc(76%", "calc(24%"]) assert.ok(!bezGoroda.includes(sled), `${sheet}, без города: ${sled}`);
    assert.equal(levyPodval(bezGoroda), "SUNRAY · КП №09784");
    assert.equal(skolko(bezGoroda, "width: calc(50% - 10mm);"), 2);
    assert.equal(shirinaPodvala(bezGoroda, "bottom-left"), "calc(50% - 10mm)");
    assert.equal(shirinaPodvala(bezGoroda, "bottom-right"), "calc(50% - 10mm)");
    assert.ok(BEZ_STILEI(bezGoroda).includes(`<div class="tb-ln"><a href="https://${OSNOVNOY_SAYT}/">${OSNOVNOY_SAYT}</a></div>`));
    // «города нет» в любом виде — страница побайтно та же, что без поля
    for (const cityContext of [undefined, null, {}, { name: "" }, { name: "   " }, { name: 5 }, { siteHost: "istra.zhalyuzi-sunray.ru" }, "Истра", ["Истра"], 5, true]) {
      assert.equal(smeta({ cityContext, sheet }), bezGoroda, `${sheet}: cityContext = ${JSON.stringify(cityContext) ?? "undefined"}`);
    }
  }
});

test("город в странице: длинное имя режется один раз и одинаково в шапке, метке и подвале; пробелы и & \" в имени — экранированы в разметке и CSS-кодами в подвале; хост без города не нужен", () => {
  for (const sheet of FORMATY_LISTA) {
    const html = smeta({ cityContext: { name: "  Красная   Пахра-на-Оке и далее ", siteHost: "pahra.zhalyuzi-sunray.ru" }, sheet });
    const razmetka = BEZ_STILEI(html);
    assert.ok(razmetka.includes("<i>Объект</i><span>Красная Пахра…</span>"), `${sheet}: шапка`);
    assert.ok(razmetka.includes("<i>Объект</i><b>Красная Пахра…</b>"), `${sheet}: метка`);
    assert.equal(levyPodval(html), "SUNRAY · КП №09784 · Объект: Красная Пахра…", `${sheet}: подвал`);
    assert.ok(razmetka.includes('<a href="https://pahra.zhalyuzi-sunray.ru/">pahra.zhalyuzi-sunray.ru</a>'));

    const osobyy = smeta({ cityContext: { name: 'Ростов & "Дон"' }, sheet });
    assert.ok(BEZ_STILEI(osobyy).includes("<i>Объект</i><span>Ростов &amp; &quot;Дон&quot;</span>"), sheet);
    const podval = levyPodval(osobyy);
    assert.ok(podval !== null && podval.endsWith("Ростов \\26  \\22 Дон\\22 ") && !/[<>&"']/.test(podval), `${sheet}: ${podval}`);
    assert.ok(BEZ_STILEI(osobyy).includes(`<a href="https://${OSNOVNOY_SAYT}/">`), "без siteHost — основной сайт");
  }
});

test("город объекта: обрезка снимает висячие тире и запятые, имя из одних невидимых знаков — города нет (разбор проверяющих 20.10.2026)", () => {
  const imya = (name) => gorodObekta({ name }).name;
  assert.equal(imya("Ростов – на – Дону – Большой"), "Ростов…");
  assert.equal(imya("Петропавловск — Камчатский Большой"), "Петропавловск…");
  assert.equal(imya("Красная Пахра, г. Москва"), "Красная Пахра…");
  assert.equal(imya("Красная Пахра-на-Оке и далее"), "Красная Пахра…");
  assert.equal(imya("Лосино-Петровский"), "Лосино-Петровский");
  assert.equal(imya("-".repeat(25)), "");
  // нулевой ширины, невидимый разделитель, braille-пустышка, хангыль-заполнитель, selector-16: видимого знака нет
  for (const c of ["\u200b", "\u2060", "\u3164", "\u2800", "\u115f", "\u180e", "\u00ad", "\u034f", "\ufe0f", "\u200e", "\u061c"]) {
    assert.equal(imya(c.repeat(3)), "", `U+${c.codePointAt(0).toString(16)}`);
  }
  assert.equal(imya("\u200bИстра\u200b"), "\u200bИстра\u200b", "видимые знаки среди невидимых — имя остаётся как есть");
});

test("оценка карточки compact/pc: ряд «цена + НДС» (у ПК и «старая цена −N %») сужает колонку названия — материал, влезавший в строку, считается в две (разбор проверяющих 20.10.2026)", () => {
  const num = (n) => String(n);
  const rub = (n) => `${n} ₽`;
  const h = (item, G) => estCardCompact(item, { hasAnyDiscount: true, hasAnyVat: true, num, rub, G });
  const bez = { productLabel: "Зебра", quantity: 2, price: 50000, discountPercent: 0, priceMode: "total", vatEnabled: false };
  // ПК: материал в 49 знаков — одна строка без цен справа и две, когда рядом стоит ряд скидки или НДС
  const pk = { ...bez, materialName: "Алюминий 25 мм, белый матовый RAL 9003, цвет 7016" };
  assert.equal(h(pk, CP_PC), 53);
  assert.equal(h({ ...pk, discountPercent: 33 }, CP_PC), 69.3);
  assert.equal(h({ ...pk, vatEnabled: true }, CP_PC), 69.3);
  // A5: материал в 75 знаков — только ряд НДС сужает колонку (скидка одна — нет)
  const a5 = { ...bez, materialName: "Блэкаут Скай, графитово-серый 4417, короб белый матовый, направляющие белые" };
  assert.equal(h(a5, CP_A5), 69.3);
  assert.equal(h({ ...a5, discountPercent: 33 }, CP_A5), 69.3);
  assert.ok(Math.abs(h({ ...a5, vatEnabled: true }, CP_A5) - 85.6) < 1e-9);
  // узкие ёмкости строки — часть калибровки: уже обычных
  for (const G of [CP_A5, CP_PC]) {
    assert.ok(G.NAME_CHARS_NARROW < G.NAME_CHARS && G.SUB_CHARS_NARROW < G.SUB_CHARS);
  }
  assert.deepEqual([CP_A5.NAME_CHARS_NARROW, CP_A5.SUB_CHARS_NARROW, CP_PC.NAME_CHARS_NARROW, CP_PC.SUB_CHARS_NARROW], [27, 36, 32, 46]);
});
