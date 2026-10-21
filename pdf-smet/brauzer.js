/**
 * Chrome на одну печать (PLANS/SERVER/05-pdf-smet, буква Б).
 *
 * Каждая смета печатается в своём Chrome: запустили, напечатали, закрыли — между печатями память свободна.
 * Печатает один, остальные ждут своей очереди; ждущих больше MAX_ZHDUT или ждущий дольше ZHDAT_MS — PechatZanyata
 * (route.js ответит 503). Ушёл клиент, пока печать ждала места, — Chrome для неё не запускают, место идёт следующему.
 * Запуск вместе с печатью ограничен SROK_MS: не уложился — Chrome снимается, ошибка идёт в route.js (там 502).
 *
 * Какой Chrome. На Linux (Render) — сжатый Chrome из npm-пакета @sparticuz/chromium; на Mac — Google Chrome по
 * CHROME_PATH или из /Applications. puppeteer-core и @sparticuz/chromium (оба ESM) подключаются через import() в момент
 * первой печати: пока смет никто не печатает, сервер их не грузит.
 */

const fs = require('fs');
const { pechatatPdf } = require('./pechat');

const MAX_ZHDUT = 5; // сколько печатей может ждать, пока одна идёт; следующая получает отказ
const ZHDAT_MS = 45000; // сколько печать ждёт места в очереди; дольше — тот же отказ PechatZanyata (503)
const SROK_MS = 30000; // запуск Chrome + печать одной сметы
const ZAKRYTIE_MS = 5000; // сколько ждём штатного закрытия Chrome, потом SIGKILL
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

class PechatZanyata extends Error {
  constructor() {
    super('печать занята, повторите через минуту');
    this.name = 'PechatZanyata';
    this.code = 'PECHAT_ZANYATA';
  }
}

/** Клиент оборвал запрос, пока печать ждала места: печатать некому, route.js ничего не отвечает */
class KlientUshel extends Error {
  constructor() {
    super('клиент ушёл, пока печать ждала места');
    this.name = 'KlientUshel';
    this.code = 'KLIENT_USHEL';
  }
}

/** Promise.race с таймером, который не остаётся висеть после победы */
function sPredelom(promise, ms, text) {
  let timer;
  const srok = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(text)), ms); });
  return Promise.race([promise, srok]).finally(() => clearTimeout(timer));
}

// Сигналы puppeteer не перехватывает: иначе при SIGTERM (Render останавливает старую копию) процесс не завершался бы,
// пока идёт печать (PLANS/PROVERKI/2026-10-17-pdf-smet-server, плитка 23)
const SIGNALY_NE_PEREHVATYVAT = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };

/**
 * Запускает Chrome. Linux — @sparticuz/chromium (путь к Chrome и аргументы из пакета); иначе — Chrome с Mac.
 * zagruzit и platforma нужны тестам (подставные puppeteer и chromium без настоящего Chrome); argumenty — добавочные аргументы запуска на эту печать.
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function zapustitChrome({ srok = SROK_MS, zagruzit = (imya) => import(imya), platforma = process.platform, argumenty = [] } = {}) {
  const { default: puppeteer } = await zagruzit('puppeteer-core');
  if (platforma === 'linux') {
    const { default: chromium } = await zagruzit('@sparticuz/chromium');
    return puppeteer.launch({
      ...SIGNALY_NE_PEREHVATYVAT,
      args: await puppeteer.defaultArgs({ args: [...chromium.args, ...argumenty], headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
      timeout: srok,
    });
  }
  const executablePath = process.env.CHROME_PATH || MAC_CHROME;
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Chrome не найден по пути ${executablePath}: на этом компьютере задайте CHROME_PATH`);
  }
  return puppeteer.launch({ ...SIGNALY_NE_PEREHVATYVAT, executablePath, headless: true, pipe: true, timeout: srok, args: argumenty });
}

/** Закрывает Chrome; не закрылся за zakrytieMs (по умолчанию ZAKRYTIE_MS) или с ошибкой — убивает процесс. Сама не бросает. */
async function zakrytChrome(browser, zakrytieMs = ZAKRYTIE_MS) {
  try {
    await sPredelom(browser.close(), zakrytieMs, 'Chrome не закрылся');
  } catch (e) {
    try { browser.process()?.kill('SIGKILL'); } catch (e2) { /* процесса уже нет */ }
  }
}

/** Один Chrome на одну печать, в пределах srok; после печати (и после ошибки) Chrome закрыт. */
async function pechatNaOdnomChrome({ zapustit, pechatat, html, srok, zakrytieMs, argumenty }) {
  let browser = null;
  let konec = false;
  const rabota = (async () => {
    const b = await zapustit({ srok, argumenty });
    browser = b;
    // Срок вышел, пока Chrome запускался: печатать уже некому, браузер закрываем здесь
    if (konec) { await zakrytChrome(b, zakrytieMs); throw new Error('печать снята по сроку'); }
    return pechatat(b, html, { timeout: srok });
  })();
  try {
    return await sPredelom(rabota, srok, `печать не уложилась в ${srok / 1000} с`);
  } finally {
    konec = true;
    if (browser) await zakrytChrome(browser, zakrytieMs);
  }
}

/**
 * Печатник с очередью. Параметры нужны тестам (подставной запуск и печать без настоящего Chrome, короткие сроки).
 * Вернувшаяся функция: klientTut() — «клиент ещё ждёт ответа»; ушёл, пока печать ждала места, — KlientUshel без запуска Chrome.
 * pechatat в её опциях — печатник страницы на эту одну печать вместо заданного при создании, argumenty — добавочные аргументы запуска Chrome на эту печать
 * (POST /api/pdf/smeta-html печатает документ CRM со строгим белым списком адресов и запретом сети в самом Chrome); очередь, запуск Chrome и сроки у всех
 * печатей общие.
 * @returns {(html: string, options?: { klientTut?: () => boolean, pechatat?: typeof pechatatPdf, argumenty?: string[] }) => Promise<Buffer>}
 */
function sozdatPechatnika({
  zapustit = zapustitChrome, pechatat = pechatatPdf, maxZhdut = MAX_ZHDUT, srok = SROK_MS,
  zhdatMs = ZHDAT_MS, zakrytieMs = ZAKRYTIE_MS,
} = {}) {
  let zanyato = false;
  const ozhidayut = []; // по порядку: кто ждёт места, { resolve, taymer }

  async function vzyatMesto() {
    if (!zanyato) { zanyato = true; return; }
    if (ozhidayut.length >= maxZhdut) throw new PechatZanyata();
    await new Promise((resolve, reject) => {
      const zhdun = { resolve, taymer: null };
      // Ждёт дольше zhdatMs — выходит из очереди с тем же отказом, что и при полной очереди
      zhdun.taymer = setTimeout(() => {
        const i = ozhidayut.indexOf(zhdun);
        if (i >= 0) ozhidayut.splice(i, 1);
        reject(new PechatZanyata());
      }, zhdatMs);
      ozhidayut.push(zhdun);
    });
  }
  function otdatMesto() {
    const sleduyushchiy = ozhidayut.shift();
    if (sleduyushchiy) {
      clearTimeout(sleduyushchiy.taymer); // таймер ожидания не должен жить после выхода из очереди
      sleduyushchiy.resolve(); // место переходит следующему, занято остаётся
    } else zanyato = false;
  }

  return async function pechatatSmetu(html, { klientTut = () => true, pechatat: pechatatStranicu = pechatat, argumenty } = {}) {
    await vzyatMesto();
    try {
      // Место получено, Chrome ещё не запускали: ушедшему клиенту печатать незачем, место уйдёт следующему (finally)
      if (!klientTut()) throw new KlientUshel();
      return await pechatNaOdnomChrome({ zapustit, pechatat: pechatatStranicu, html, srok, zakrytieMs, argumenty });
    } finally {
      otdatMesto();
    }
  };
}

const pechatatSmetu = sozdatPechatnika();

// zapustitChrome — для теста запуска (флаги сигналов); остальные константы наружу не нужны
module.exports = {
  pechatatSmetu,
  sozdatPechatnika,
  zapustitChrome,
  PechatZanyata,
};
