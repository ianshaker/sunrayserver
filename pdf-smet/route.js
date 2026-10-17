// ============================================================================
// POST /api/pdf/smeta — PDF сметы, напечатанный Chrome'ом нашего сервера (PLANS/SERVER/05-pdf-smet, буква Б).
//
// Заменяет Deno-функцию Supabase generate-estimate-pdf (index.ts) вместе с Api2Pdf: то же тело запроса, тот же шаблон
// (shablon.js), тот же ответ — application/pdf и имя файла как в index.ts:88-101.
//
// Body: { clientData, items, headerImageUrl?, promoDiscount?, vatIncluded5?, groups?, montage?, validUntil?, createdDay?, printDay? }
// Вход: Authorization: Bearer <токен сессии CRM> — проверка assertAuthenticatedFromRequest (подменяется параметром propusk).
// Ответ: 200 PDF | 401 нет пропуска | 400 пустой items или тело, из которого смета не собирается |
//        503 печать занята (Retry-After: 60) | 502 Chrome не напечатал или не уложился в срок.
// ============================================================================

const { buildHtml, dozapolnitPozicii, imyaFayla } = require('./shablon');
const { pechatatSmetu } = require('./brauzer');

/**
 * Content-Disposition как в index.ts:95-101. В filename="…" остаётся только печатный ASCII без кавычек и «\»: имя вроде
 * «#09784.pdf» от этого не меняется, а имя с кириллицей или переводом строки не роняет заголовок (полное имя — в filename*).
 */
function zagolovokFayla(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ propusk?: Function, pechatat?: (html: string) => Promise<Buffer> }} [options]
 *   propusk(request, reply) → пользователь | null (null — ответ уже отправлен); по умолчанию assertAuthenticatedFromRequest.
 *   pechatat(html) → Buffer с PDF; по умолчанию Chrome на одну печать с очередью (brauzer.js).
 */
function registerPdfSmetRoute(fastify, { propusk, pechatat = pechatatSmetu } = {}) {
  // Проверка менеджера подключается при первом запросе: так тесты с подменой пропуска не тянут клиент Supabase
  const proverit = propusk
    || ((request, reply) => require('../lib/telegramBotChatsAdmin').assertAuthenticatedFromRequest(request, reply));

  // Смета — до сотни позиций текстом: общий лимит сервера 55 МБ тут ни к чему
  fastify.post('/api/pdf/smeta', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const user = await proverit(request, reply);
    if (!user) return reply;

    const body = request.body && typeof request.body === 'object' ? request.body : {};
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'No items provided', details: 'В смете нет ни одной позиции' });
    }

    let html;
    let filename;
    try {
      html = buildHtml({ ...body, items: dozapolnitPozicii(body.items) });
      filename = imyaFayla(body);
    } catch (e) {
      console.error('[pdf-smet] смета не собралась из присланных данных:', e);
      return reply.code(400).send({
        error: 'Invalid estimate data',
        details: `Смета не собралась из присланных данных: ${e && e.message ? e.message : e}`,
      });
    }

    const t0 = Date.now();
    let pdf;
    try {
      pdf = await pechatat(html);
    } catch (e) {
      if (e && e.code === 'PECHAT_ZANYATA') {
        return reply.code(503).header('Retry-After', '60')
          .send({ error: 'Print queue is full', details: 'Печать занята, повторите через минуту' });
      }
      console.error('[pdf-smet] печать не удалась:', e);
      return reply.code(502).send({
        error: 'PDF generation failed',
        details: `Не удалось напечатать PDF: ${e && e.message ? e.message : e}`,
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
