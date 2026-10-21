// ============================================================================
// POST /api/pdf/smeta-html — PDF из готового печатного документа CRM (окно «Превью сметы» → «Скачать PDF», PLANS/CRM/23-smeta-html-zoom).
//
// Отличие от POST /api/pdf/smeta: сервер не собирает смету из цифр, а печатает HTML, который собрала сама CRM (buildPrintDoc,
// preview/printSheets.ts: все листы одной строкой, встроенный CSS, @page листа, inline-SVG, шрифт Montserrat с Google Fonts). Печатник тот же:
// очередь, один Chrome на печать, срок 30 с и опции печати (brauzer.js, pechat.js); белый список адресов строже — razreshenAdresDokumenta
// (data:, about:blank и шрифты Google; Storage Supabase не пускается), JS в странице выключен, а сам Chrome запускается с запретом сети кроме шрифтов
// Google (ARGUMENTY_ZAPRET_SETI): подсказки <link rel="prefetch|prerender|preconnect"> перехват запросов не видит.
//
// Body: { html: string } — печатный документ целиком.
//   Границы: тело запроса не больше 2 МБ (bodyLimit маршрута, 413 приходит ещё до проверки пропуска); html — непустая строка не короче 2 КБ,
//   в ней есть «<html» и «@page» (регистр не важен). Размер листа и поля берутся из @page документа, колонтитулов печать не добавляет.
// Вход: Authorization: Bearer <токен сессии CRM> — как у /api/pdf/smeta (assertAuthenticatedFromRequest, подменяется параметром propusk).
//   CORS — общий плагин сервера (server.js: origin '*', методы GET, POST, OPTIONS), на самом маршруте ничего не настраивается.
// Ответ: 200 application/pdf (файл smeta.pdf) | 401 нет или негодный пропуск | 400 html не строка, пустой, короче 2 КБ, без «<html» или без «@page»
//        | 413 тело больше 2 МБ | 503 печать занята (Retry-After: 60) | 502 Chrome не напечатал или не уложился в срок. Клиент ушёл, пока печать
//        ждала места, — печати нет и ответа нет. В тексте ответа ошибок Chrome и путей нет: полный текст — в console.error. В журнал идут только
//        размеры (html, pdf, миллисекунды), текст документа — никогда: в нём имя и телефон клиента.
// ============================================================================

const { zagolovokFayla } = require('./route');
const { pechatatSmetu } = require('./brauzer');
const { pechatatDokument, ARGUMENTY_ZAPRET_SETI } = require('./pechat');

const BODY_MAX = 2 * 1024 * 1024; // байт: тело запроса целиком; больше — 413 от Fastify до чтения пропуска
const HTML_MIN = 2 * 1024; // байт: печатный документ с @page и стилями короче не бывает — меньше это пустышка или не тот текст
const IMYA_FAYLA = 'smeta.pdf'; // CRM сохраняет под своим именем (#номер.pdf); заголовок — как у /api/pdf/smeta, только имя без номера

/**
 * Проверка тела запроса. Нет html, пустая строка и одни пробелы — «нет html»; не строка, короче 2 КБ, нет «<html» или «@page» — «неверный html».
 * @param {any} body — request.body как пришёл
 * @returns {{ error: string, details: string } | null} — тело ответа 400 или null, если всё в порядке
 */
function oshibkaHtml(body) {
  const html = body && typeof body === 'object' && !Array.isArray(body) ? body.html : undefined;
  if (html == null || (typeof html === 'string' && html.trim() === '')) {
    return { error: 'No html provided', details: 'В запросе нет документа для печати: поле html пустое' };
  }
  if (typeof html !== 'string') {
    return { error: 'Invalid html', details: 'Поле html должно быть строкой с печатным документом' };
  }
  if (Buffer.byteLength(html, 'utf8') < HTML_MIN) {
    return { error: 'Invalid html', details: `Документ слишком короткий: печатный документ не короче ${HTML_MIN / 1024} КБ` };
  }
  if (!/<html\b/i.test(html)) {
    return { error: 'Invalid html', details: 'В документе нет тега <html>: это не печатный документ' };
  }
  if (!/@page\b/i.test(html)) {
    return { error: 'Invalid html', details: 'В документе нет правила @page: не задан размер листа' };
  }
  return null;
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ propusk?: Function, pechatat?: (html: string, options?: { klientTut?: () => boolean, pechatat?: Function }) => Promise<Buffer> }} [options]
 *   propusk(request, reply) → пользователь | null (null — ответ уже отправлен); по умолчанию assertAuthenticatedFromRequest.
 *   pechatat(html, { klientTut, pechatat, argumenty }) → Buffer с PDF; по умолчанию очередь печатника сметы (brauzer.js: один Chrome на всё),
 *   в неё уходят pechatat: pechatatDokument (печатник страницы со строгим белым списком адресов) и argumenty: ARGUMENTY_ZAPRET_SETI (запрет сети в Chrome).
 */
function registerPdfSmetHtmlRoute(fastify, { propusk, pechatat = pechatatSmetu } = {}) {
  // Проверка менеджера подключается при первом запросе: так тесты с подменой пропуска не тянут клиент Supabase
  const proverit = propusk
    || ((request, reply) => require('../lib/telegramBotChatsAdmin').assertAuthenticatedFromRequest(request, reply));

  // Документ — до пары сотен КБ текстом: общий лимит сервера 55 МБ тут ни к чему
  fastify.post('/api/pdf/smeta-html', { bodyLimit: BODY_MAX }, async (request, reply) => {
    // Клиент оборвал соединение, не дождавшись ответа ('close' у reply.raw, а не у request.raw — см. route.js)
    let klientUshel = false;
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) klientUshel = true; });

    const user = await proverit(request, reply);
    if (!user) return reply;

    const oshibka = oshibkaHtml(request.body);
    if (oshibka) return reply.code(400).send(oshibka);
    const { html } = request.body;

    const t0 = Date.now();
    let pdf;
    try {
      pdf = await pechatat(html, { klientTut: () => !klientUshel, pechatat: pechatatDokument, argumenty: ARGUMENTY_ZAPRET_SETI });
    } catch (e) {
      if (e && e.code === 'PECHAT_ZANYATA') {
        return reply.code(503).header('Retry-After', '60')
          .send({ error: 'Print queue is full', details: 'Печать занята, повторите через минуту' });
      }
      if (e && e.code === 'KLIENT_USHEL') {
        console.log('[pdf-smet] клиент ушёл, пока печать ждала места: документ CRM не печатался, ответа нет');
        return reply; // отвечать некому; Chrome не запускали, место печати уже у следующего
      }
      // Клиенту — общая фраза: в тексте ошибки Chrome бывают пути (/tmp/chromium) и английские строки стека
      console.error('[pdf-smet] печать документа CRM не удалась:', e);
      return reply.code(502).send({
        error: 'PDF generation failed',
        details: 'Не удалось напечатать PDF, повторите через минуту',
      });
    }

    console.log(`[pdf-smet] напечатан документ CRM: html ${Buffer.byteLength(html, 'utf8')} байт, pdf ${pdf.length} байт, ${Date.now() - t0} мс`);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', zagolovokFayla(IMYA_FAYLA))
      .send(pdf);
  });
}

module.exports = { registerPdfSmetHtmlRoute, oshibkaHtml, BODY_MAX, HTML_MIN };
