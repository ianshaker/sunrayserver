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
 *
 * Готовый печатный документ CRM (POST /api/pdf/smeta-html, route-html.js): HTML приходит от клиента целиком, а не собирается нашим шаблоном, поэтому
 * страница та же (pechatatPdf), а белый список строже — razreshenAdresDokumenta: только data:, about:blank и шрифты Google, Storage Supabase не пускается.
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

// Запрет сети на уровне самого Chrome для документа CRM (POST /api/pdf/smeta-html). Перехват запросов страницы не видит подсказки браузера
// <link rel="prefetch">, <link rel="prerender"> и <link rel="preconnect">: проба 21.10.2026 показала, что они доходят до 127.0.0.1 как настоящий GET или
// TCP-соединение (с CSP prerender и preconnect тоже проходят). Поэтому всё, кроме шрифтов Google, уходит на глухой прокси (порт 1: отказ сразу);
// <-loopback> убирает обход прокси для localhost и 127.0.0.1. С этими флагами проба — ни одного запроса и соединения, шрифты печатаются.
const ARGUMENTY_ZAPRET_SETI = [
  '--proxy-server=socks5://127.0.0.1:1',
  `--proxy-bypass-list=${[...HOSTY_SHRIFTOV].join(';')};<-loopback>`,
];

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
 * Белый список для готового печатного документа CRM (POST /api/pdf/smeta-html): строже razreshenAdres.
 * Разрешено: data:, about:blank и https-адреса шрифтов Google (fonts.googleapis.com, fonts.gstatic.com) на обычном порту, без логина и пароля
 * в адресе. Всё остальное — нельзя: Storage Supabase, file:, blob:, ws:, ftp:, любой http: (в том числе localhost, 127.0.0.1, [::1], метаданные
 * облака 169.254.169.254), чужие хосты и чужие порты.
 * @param {string} adres
 * @returns {boolean}
 */
function razreshenAdresDokumenta(adres) {
  if (typeof adres !== 'string') return false;
  let u;
  try { u = new URL(adres); } catch (e) { return false; }
  if (u.protocol === 'data:') return true;
  if (u.protocol === 'about:') return adres === 'about:blank';
  return u.protocol === 'https:' && u.port === '' && u.username === '' && u.password === '' && HOSTY_SHRIFTOV.has(u.hostname);
}

/**
 * @param {import('puppeteer-core').Browser} browser — уже запущенный браузер (puppeteer / puppeteer-core)
 * @param {string} html — готовая страница, из shablon.buildHtml
 * @param {{ timeout?: number, supabaseUrl?: string, razreshen?: (adres: string) => boolean }} [options] — timeout: предел в миллисекундах на
 *   загрузку страницы и на саму печать; supabaseUrl: чей Storage пускать (по умолчанию SUPABASE_URL шаблона); razreshen: какие адреса
 *   странице можно грузить (по умолчанию razreshenAdres со Storage из supabaseUrl; для документа CRM — razreshenAdresDokumenta)
 * @returns {Promise<Buffer>} — PDF
 */
async function pechatatPdf(browser, html, {
  timeout = 30000, supabaseUrl = SUPABASE_URL, razreshen = (adres) => razreshenAdres(adres, supabaseUrl),
} = {}) {
  const page = await browser.newPage();
  try {
    // JS в странице не нужен, а чужой HTML исполнять нельзя; до setContent, иначе скрипты успеют сработать
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isInterceptResolutionHandled()) return;
      // Отказ continue/abort (страница уже закрыта) не должен ронять сервер необработанным rejection
      if (razreshen(request.url())) Promise.resolve(request.continue()).catch(() => {});
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

/**
 * Печать готового печатного документа CRM: та же страница и те же опции печати, что у сметы (pechatatPdf: JS выключен, перехват запросов
 * до setContent, ожидание сети и document.fonts.ready, лист и поля из @page документа), но адреса — только razreshenAdresDokumenta.
 * Подходит как pechatat для очереди печатника (brauzer.js): (browser, html, { timeout }) → Buffer.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} html — печатный документ целиком (<html> со встроенным CSS и @page)
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<Buffer>} — PDF
 */
function pechatatDokument(browser, html, { timeout } = {}) {
  return pechatatPdf(browser, html, { timeout, razreshen: razreshenAdresDokumenta });
}

module.exports = { pechatatPdf, pechatatDokument, razreshenAdres, razreshenAdresDokumenta, ARGUMENTY_ZAPRET_SETI };
