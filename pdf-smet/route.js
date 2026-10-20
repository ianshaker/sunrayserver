// ============================================================================
// POST /api/pdf/smeta — PDF сметы, напечатанный Chrome'ом нашего сервера (PLANS/SERVER/05-pdf-smet, буква Б).
//
// Заменяет Deno-функцию Supabase generate-estimate-pdf (index.ts) вместе с Api2Pdf: то же тело запроса, тот же шаблон
// (shablon.js), тот же ответ — application/pdf и имя файла как в index.ts:88-101.
//
// Body: { clientData, items, headerImageUrl?, promoDiscount?, promoFromQty?, vatIncluded5?, groups?, montage?, validUntil?, createdDay?, printDay?, sheet?, cityContext? }
//   Буква Б (20.10.2026): items[i].priceMode? 'total' (по умолчанию, цена за всю позицию) | 'unit' (за штуку); promoDiscount — целое 1–90; promoFromQty — целое 2–20 (нет — «от 2 изделий»);
//   promoApply? не читается: CRM шлёт уже посчитанные цифры (эффективные discountPercent / discountedPrice), сервер акцию не применяет.
//   Буква В (20.10.2026): items[i].room? — помещение (строка; trim, пробелы в один, до 60 знаков; пусто — «без помещения»), items[i].widthMm? / heightMm? — размеры, целые мм 1–20000, оба или ни одного.
//   Формат листа и город (20.10.2026): sheet? 'big' (по умолчанию, лист A5 как раньше) | 'compact' (лист A5, блоки плотнее) | 'pc' (лист A4, вся смета на одном листе, если помещается);
//   cityContext? { name, siteHost? } — город объекта: name — строка 1–60 знаков с видимым знаком (на листе режется до 18 знаков с «…», CITY_SHOW_MAX в shablon.js), siteHost — только zhalyuzi-sunray.ru или его поддомен (иначе 400). Нет полей — лист как раньше.
//   Ревью (20.10.2026): у позиции с priceMode 'unit' количество умножает деньги, поэтому quantity — число > 0 и ≤ 100000, price — от 0 до 1e9, discountPercent (если прислан) — от 0 до 100; у 'total' границ нет (старые тела печатаются как раньше).
// Вход: Authorization: Bearer <токен сессии CRM> — проверка assertAuthenticatedFromRequest (подменяется параметром propusk).
// Ответ: 200 PDF | 401 нет пропуска | 400 пустой items, слишком много позиций или групп, неверные числа, неверные promoDiscount / promoFromQty / priceMode / room / widthMm / heightMm / sheet / cityContext, у позиций «за штуку» — quantity / price / discountPercent, или тело,
//        из которого смета не собирается | 503 печать занята (Retry-After: 60) | 502 Chrome не напечатал или не уложился
//        в срок. Клиент ушёл, пока печать ждала места, — печати нет и ответа нет. В тексте ответа ошибок Chrome и путей нет:
//        полный текст — в console.error.
// ============================================================================

const { buildHtml, dozapolnitPozicii, imyaFayla, denPechati, privestiChisla, SITE_HOST_RE, VIDIMOE_RE } = require('./shablon');
const { pechatatSmetu } = require('./brauzer');

// Реальная смета — до 22 позиций; больше — уже не смета, а нагрузка: шаблон считается синхронно в главном потоке сервера
const MAX_POZICIY = 400;
const MAX_GRUPP = 100;

// Буква Б: допустимые значения новых полей (ТЗ tz-uluchsheniya-smety.md §1): скидка по акции — целое 1–90 (раньше 20|25), «от N изделий» — целое 2–20 (нет — «от 2»),
// способ цены позиции — 'total' (за всю позицию, по умолчанию) или 'unit' (за штуку)
const PRICE_MODES = new Set(['total', 'unit']);
// Формат листа (20.10.2026): большой как раньше, «компактный» A5 и «ПК» A4. Мусор — 400, а не тихий «большой»: ошибка CRM должна быть видна
const SHEETS = new Set(['big', 'compact', 'pc']);
const CITY_NAME_MAX = 60;
const celoeV = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// Режим «цена за штуку» (priceMode 'unit', ревью 20.10.2026): деньги позиции = price × quantity, поэтому числа позиции держим в границах — иначе −3 штуки,
// 1e9 штук или цена 1e308 («∞» в PDF) дали бы 200 и смету с нелепой суммой. У 'total' границ нет: старые тела печатаются ровно как раньше (golden-тест)
const UNIT_KOLICHESTVO_MAX = 100000;
const UNIT_CENA_MAX = 1e9;

/**
 * Границы чисел позиции «за штуку»: quantity — число > 0 и ≤ 100000 (дробное можно), price — от 0 до 1e9, discountPercent (если прислан) — от 0 до 100.
 * Зовётся только для priceMode === 'unit' и только после privestiChisla: числа уже числами и конечные.
 * @param {{ quantity: number, price: number, discountPercent?: number|null }} pozitsiya — позиция после privestiChisla
 * @returns {{ error: string, details: string } | null} — тело ответа 400 или null, если всё в порядке
 */
function oshibkaZaShtuku({ quantity, price, discountPercent }) {
  if (!(quantity > 0 && quantity <= UNIT_KOLICHESTVO_MAX)) {
    return { error: 'Invalid quantity', details: `Режим «цена за штуку»: количество должно быть больше 0 и не больше ${UNIT_KOLICHESTVO_MAX}` };
  }
  if (!(price >= 0 && price <= UNIT_CENA_MAX)) {
    return { error: 'Invalid price', details: `Режим «цена за штуку»: цена должна быть не меньше 0 и не больше ${UNIT_CENA_MAX}` };
  }
  if (discountPercent != null && !(discountPercent >= 0 && discountPercent <= 100)) {
    return { error: 'Invalid discountPercent', details: 'Режим «цена за штуку»: скидка должна быть числом от 0 до 100 процентов' };
  }
  return null;
}

/**
 * Проверка новых полей тела после privestiChisla (числа уже числами). Нет поля (undefined) или null — «не задано», это не ошибка.
 * Буква В: room позиции — строка (пустая или из одних пробелов = «помещения нет», длиннее 60 знаков режется в privestiChisla, это не ошибка);
 * widthMm / heightMm — целые 1–20000 мм, оба или ни одного.
 * @param {any[]} items — позиции как пришли
 * @param {{ items: any[], promoDiscount?: number|null, promoFromQty?: number|null }} chisla — результат privestiChisla (items — те же позиции, числа уже числами)
 * @returns {{ error: string, details: string } | null} — тело ответа 400 или null, если всё в порядке
 */
function oshibkaNovyhPolej(items, { items: privedennye, promoDiscount, promoFromQty }) {
  if (promoDiscount != null && !celoeV(promoDiscount, 1, 90)) {
    return { error: 'Invalid promoDiscount', details: 'Скидка по акции должна быть целым числом от 1 до 90 процентов' };
  }
  if (promoFromQty != null && !celoeV(promoFromQty, 2, 20)) {
    return { error: 'Invalid promoFromQty', details: 'Условие акции «от N изделий»: N должно быть целым числом от 2 до 20' };
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    if (item.priceMode != null && !PRICE_MODES.has(item.priceMode)) {
      return { error: 'Invalid priceMode', details: 'Способ цены позиции должен быть «total» (цена за всю позицию) или «unit» (цена за штуку)' };
    }
    if (item.priceMode === 'unit') {
      const oshibkaUnit = oshibkaZaShtuku(privedennye[i]);
      if (oshibkaUnit) return oshibkaUnit;
    }
    if (item.room != null && typeof item.room !== 'string') {
      return { error: 'Invalid room', details: 'Помещение позиции должно быть текстом (до 60 знаков)' };
    }
    const { widthMm, heightMm } = privedennye[i];
    if ((widthMm != null) !== (heightMm != null)) {
      return { error: 'Invalid size', details: 'Ширину и высоту позиции указывают вместе: нужны оба размера или ни одного' };
    }
    if (widthMm != null && !(celoeV(widthMm, 1, 20000) && celoeV(heightMm, 1, 20000))) {
      return { error: 'Invalid size', details: 'Ширина и высота позиции должны быть целым числом миллиметров от 1 до 20000' };
    }
  }
  return null;
}

/**
 * Проверка полей «формат листа» и «город объекта» (нет поля или null — «не задано», это не ошибка).
 * @param {any} body — тело запроса как пришло
 * @returns {{ error: string, details: string } | null}
 */
function oshibkaFormataIGoroda(body) {
  if (body.sheet != null && !SHEETS.has(body.sheet)) {
    return { error: 'Invalid sheet', details: 'Формат листа должен быть «big», «compact» или «pc»' };
  }
  const c = body.cityContext;
  if (c != null) {
    const imya = c && typeof c === 'object' && !Array.isArray(c) && typeof c.name === 'string' ? c.name.replace(/\s+/g, ' ').trim() : '';
    if (!imya || !VIDIMOE_RE.test(imya) || Array.from(imya).length > CITY_NAME_MAX) {
      return { error: 'Invalid cityContext', details: `Город объекта: name — строка с видимыми знаками не длиннее ${CITY_NAME_MAX} знаков` };
    }
    if (c.siteHost != null && !(typeof c.siteHost === 'string' && SITE_HOST_RE.test(c.siteHost))) {
      return { error: 'Invalid cityContext', details: 'Город объекта: siteHost — только zhalyuzi-sunray.ru или его поддомен' };
    }
  }
  return null;
}

/**
 * Content-Disposition как в index.ts:95-101. В filename="…" остаётся только печатный ASCII без кавычек и «\»: имя вроде
 * «#09784.pdf» от этого не меняется, а имя с кириллицей или переводом строки не роняет заголовок (полное имя — в filename*).
 */
function zagolovokFayla(filename) {
  // Одиночный суррогат («\ud800») роняет encodeURIComponent с URIError — после печати это 500 вместо PDF; он станет «\ufffd»
  const imya = String(filename).toWellFormed();
  const ascii = imya.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(imya)}`;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ propusk?: Function, pechatat?: (html: string, options?: { klientTut?: () => boolean }) => Promise<Buffer> }} [options]
 *   propusk(request, reply) → пользователь | null (null — ответ уже отправлен); по умолчанию assertAuthenticatedFromRequest.
 *   pechatat(html, { klientTut }) → Buffer с PDF; по умолчанию Chrome на одну печать с очередью (brauzer.js).
 *   klientTut() — «клиент ещё ждёт ответа»; ушёл — печать вправе не начинаться и бросить ошибку с code KLIENT_USHEL.
 */
function registerPdfSmetRoute(fastify, { propusk, pechatat = pechatatSmetu } = {}) {
  // Проверка менеджера подключается при первом запросе: так тесты с подменой пропуска не тянут клиент Supabase
  const proverit = propusk
    || ((request, reply) => require('../lib/telegramBotChatsAdmin').assertAuthenticatedFromRequest(request, reply));

  // Смета — до сотни позиций текстом: общий лимит сервера 55 МБ тут ни к чему
  fastify.post('/api/pdf/smeta', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    // Клиент оборвал соединение, не дождавшись ответа. 'close' у reply.raw, а не у request.raw: у request.raw в Node ≥16 он
    // приходит и когда тело прочитано; у ответа — только когда соединение закрылось, а ответ ещё не закончен
    let klientUshel = false;
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) klientUshel = true; });

    const user = await proverit(request, reply);
    if (!user) return reply;

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'No items provided', details: 'В смете нет ни одной позиции' });
    }

    if (body.items.length > MAX_POZICIY || (Array.isArray(body.groups) && body.groups.length > MAX_GRUPP)) {
      return reply.code(400).send({
        error: 'Too many items',
        details: `В смете слишком много позиций или групп: не больше ${MAX_POZICIY} позиций и ${MAX_GRUPP} групп`,
      });
    }

    // Числа в страницу идут только числами: разметка в quantity или «abc» в price отсекаются здесь
    const chisla = privestiChisla(body);
    if (!chisla) {
      return reply.code(400).send({
        error: 'Invalid numbers',
        details: 'Неверные числа в смете: количество, цена и скидка позиций, скидка по акции и условие акции «от N изделий» должны быть числами',
      });
    }

    const oshibka = oshibkaNovyhPolej(body.items, chisla) || oshibkaFormataIGoroda(body);
    if (oshibka) return reply.code(400).send(oshibka);

    let html;
    let filename;
    try {
      // День печати считаем один раз: дата в смете и имя файла берут одно значение (около полуночи не разойдутся)
      const printDay = denPechati(body.printDay);
      html = buildHtml({ ...body, printDay, promoDiscount: chisla.promoDiscount, promoFromQty: chisla.promoFromQty, items: dozapolnitPozicii(chisla.items) });
      filename = imyaFayla({ ...body, printDay });
    } catch (e) {
      // Клиенту — общая фраза; что именно не так, видно только в логе
      console.error('[pdf-smet] смета не собралась из присланных данных:', e);
      return reply.code(400).send({ error: 'Invalid estimate data', details: 'Смета не собралась из присланных данных' });
    }

    const t0 = Date.now();
    let pdf;
    try {
      pdf = await pechatat(html, { klientTut: () => !klientUshel });
    } catch (e) {
      if (e && e.code === 'PECHAT_ZANYATA') {
        return reply.code(503).header('Retry-After', '60')
          .send({ error: 'Print queue is full', details: 'Печать занята, повторите через минуту' });
      }
      if (e && e.code === 'KLIENT_USHEL') {
        console.log('[pdf-smet] клиент ушёл, пока печать ждала места: смета не печаталась, ответа нет');
        return reply; // отвечать некому; Chrome не запускали, место печати уже у следующего
      }
      // Клиенту — общая фраза: в тексте ошибки Chrome бывают пути (/tmp/chromium) и английские строки стека
      console.error('[pdf-smet] печать не удалась:', e);
      return reply.code(502).send({
        error: 'PDF generation failed',
        details: 'Не удалось напечатать PDF, повторите через минуту',
      });
    }

    console.log(`[pdf-smet] напечатано: позиций ${body.items.length}, ${pdf.length} байт, ${Date.now() - t0} мс`);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', zagolovokFayla(filename))
      .send(pdf);
  });
}

module.exports = { registerPdfSmetRoute, zagolovokFayla, oshibkaFormataIGoroda };
