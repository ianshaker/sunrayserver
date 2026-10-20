/**
 * HTML → PDF для смет (PLANS/SERVER/05-pdf-smet, буква А).
 *
 * Браузер приходит параметром, здесь его не запускают и не подключают: в пробе на Mac это установленный Google
 * Chrome, на сервере (буква Б) — Chrome сервера.
 *
 * Опции печати (19.10.2026, новый вид сметы — лист A5; 20.10.2026 — формат «ПК» на листе A4): размер листа, поля и подвал «Лист k из M» задаёт сам шаблон через
 * @page (`size: 420pt 595pt` у большого и компактного, `595pt 842pt` у «ПК», поля, margin-боксы), поэтому preferCSSPageSize: true и без format — со своим format Chrome печатал
 * бы A4 поверх @page. margin: 0 из puppeteer поля @page не перебивает (проверено печатью на Chrome 155); фон печатается.
 * Раньше, как у Api2Pdf в старой функции (generate-estimate-pdf/index.ts:52-62), было format: 'A4'.
 *
 * Защита (буква Б, дыра 5): тело запроса подставляется в HTML, а печатает его Chrome на нашем сервере. Поэтому в странице
 * выключен JS, а запросы пускаются только к data:, шрифтам Google и публичному Storage нашего Supabase — остальное abort.
 * Сама смета сейчас грузит только шрифт Google и логотип data: (печати компании из Storage в ней нет); Storage остался в списке на случай картинок из хранилища.
 */

const { SUPABASE_URL } = require('./shablon');

// Размер листа (420 × 595 pt, A5; у формата «ПК» 595 × 842 pt, A4), поля и подвал берутся из @page шаблона; format здесь задавать нельзя (см. шапку файла)
const PDF_OPTIONS = {
  preferCSSPageSize: true,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
};

const HOSTY_SHRIFTOV = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const PUT_STORAGE = '/storage/v1/object/public/';

/**
 * Можно ли странице сметы грузить этот адрес. Разрешено: data:, шрифты Google (https) и публичный Storage того же хоста,
 * что SUPABASE_URL (https, путь /storage/v1/object/public/). Всё остальное — нельзя.
 * @param {string} adres
 * @param {string} [supabaseUrl]
 * @returns {boolean}
 */
function razreshenAdres(adres, supabaseUrl = SUPABASE_URL) {
  let u;
  try { u = new URL(adres); } catch (e) { return false; }
  if (u.protocol === 'data:') return true;
  if (u.protocol !== 'https:') return false;
  if (HOSTY_SHRIFTOV.has(u.hostname)) return true;
  let s;
  try { s = new URL(supabaseUrl); } catch (e) { return false; }
  return s.protocol === 'https:' && u.host === s.host && u.pathname.startsWith(PUT_STORAGE);
}

/**
 * @param {import('puppeteer-core').Browser} browser — уже запущенный браузер (puppeteer / puppeteer-core)
 * @param {string} html — готовая страница, из shablon.buildHtml
 * @param {{ timeout?: number, supabaseUrl?: string }} [options] — timeout: предел в миллисекундах на загрузку страницы и
 *   на саму печать; supabaseUrl: чей Storage пускать (по умолчанию SUPABASE_URL шаблона)
 * @returns {Promise<Buffer>} — PDF
 */
async function pechatatPdf(browser, html, { timeout = 30000, supabaseUrl = SUPABASE_URL } = {}) {
  const page = await browser.newPage();
  try {
    // JS в странице не нужен, а чужой HTML исполнять нельзя; до setContent, иначе скрипты успеют сработать
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) return;
      // Отказ continue/abort (страница уже закрыта) не должен ронять сервер необработанным rejection
      if (razreshenAdres(request.url(), supabaseUrl)) Promise.resolve(request.continue()).catch(() => {});
      else {
        console.warn(`[pdf-smet] запрос страницы сметы заблокирован: ${request.url().slice(0, 200)}`);
        Promise.resolve(request.abort('blockedbyclient')).catch(() => {});
      }
    });
    // Ждём сеть (шрифт Google; логотип — data:) и шрифты: иначе смета выйдет другим шрифтом
    await page.setContent(html, { waitUntil: 'networkidle0', timeout });
    await page.evaluate(async () => { await document.fonts.ready; });
    const pdf = await page.pdf({ ...PDF_OPTIONS, timeout });
    return Buffer.from(pdf);
  } finally {
    // Ошибка закрытия не должна затирать ошибку печати (или превращать готовый PDF в отказ)
    await page.close().catch(() => {});
  }
}

module.exports = { pechatatPdf, razreshenAdres };
