// ============================================================================
// POST /api/pdf/smeta — PDF сметы, напечатанный Chrome'ом нашего сервера (PLANS/SERVER/05-pdf-smet, буква Б).
//
// Заменяет Deno-функцию Supabase generate-estimate-pdf (index.ts) вместе с Api2Pdf: то же тело запроса, тот же шаблон
// (shablon.js), тот же ответ — application/pdf и имя файла как в index.ts:88-101.
//
// Body: { clientData, items, headerImageUrl?, promoDiscount?, vatIncluded5?, groups?, montage?, validUntil?, createdDay?, printDay? }
// Вход: Authorization: Bearer <токен сессии CRM> — проверка assertAuthenticatedFromRequest (подменяется параметром propusk).
// Ответ: 200 PDF | 401 нет пропуска | 400 пустой items, слишком много позиций или групп, неверные числа или тело,
//        из которого смета не собирается | 503 печать занята (Retry-After: 60) | 502 Chrome не напечатал или не уложился
//        в срок. Клиент ушёл, пока печать ждала места, — печати нет и ответа нет. В тексте ответа ошибок Chrome и путей нет:
//        полный текст — в console.error.
// ============================================================================

const { buildHtml, dozapolnitPozicii, imyaFayla, denPechati, privestiChisla } = require('./shablon');
const { pechatatSmetu } = require('./brauzer');

// Реальная смета — до 22 позиций; больше — уже не смета, а нагрузка: шаблон считается синхронно в главном потоке сервера
const MAX_POZICIY = 400;
const MAX_GRUPP = 100;

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
        details: 'Неверные числа в смете: количество, цена и скидка позиций и скидка по акции должны быть числами',
      });
    }

    let html;
    let filename;
    try {
      // День печати считаем один раз: дата в смете и имя файла берут одно значение (около полуночи не разойдутся)
      const printDay = denPechati(body.printDay);
      html = buildHtml({ ...body, printDay, promoDiscount: chisla.promoDiscount, items: dozapolnitPozicii(chisla.items) });
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

module.exports = { registerPdfSmetRoute, zagolovokFayla };
