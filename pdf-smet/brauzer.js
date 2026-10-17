/**
 * Chrome на одну печать (PLANS/SERVER/05-pdf-smet, буква Б).
 *
 * Каждая смета печатается в своём Chrome: запустили, напечатали, закрыли — между печатями память свободна.
 * Печатает один, остальные ждут своей очереди; ждущих больше MAX_ZHDUT — PechatZanyata (route.js ответит 503).
 * Запуск вместе с печатью ограничен SROK_MS: не уложился — Chrome снимается, ошибка идёт в route.js (там 502).
 *
 * Какой Chrome. На Linux (Render) — сжатый Chrome из npm-пакета @sparticuz/chromium; на Mac — Google Chrome по
 * CHROME_PATH или из /Applications. puppeteer-core и @sparticuz/chromium (оба ESM) подключаются через import() в момент
 * первой печати: пока смет никто не печатает, сервер их не грузит.
 */

const fs = require('fs');
const { pechatatPdf } = require('./pechat');

const MAX_ZHDUT = 5; // сколько печатей может ждать, пока одна идёт; следующая получает отказ
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

/** Promise.race с таймером, который не остаётся висеть после победы */
function sPredelom(promise, ms, text) {
  let timer;
  const srok = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(text)), ms); });
  return Promise.race([promise, srok]).finally(() => clearTimeout(timer));
}

/**
 * Запускает Chrome. Linux — @sparticuz/chromium (путь к Chrome и аргументы из пакета); иначе — Chrome с Mac.
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
async function zapustitChrome({ srok = SROK_MS } = {}) {
  const { default: puppeteer } = await import('puppeteer-core');
  if (process.platform === 'linux') {
    const { default: chromium } = await import('@sparticuz/chromium');
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
      timeout: srok,
    });
  }
  const executablePath = process.env.CHROME_PATH || MAC_CHROME;
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Chrome не найден по пути ${executablePath}: на этом компьютере задайте CHROME_PATH`);
  }
  return puppeteer.launch({ executablePath, headless: true, pipe: true, timeout: srok });
}

/** Закрывает Chrome; не закрылся за ZAKRYTIE_MS или с ошибкой — убивает процесс. Сама не бросает. */
async function zakrytChrome(browser) {
  try {
    await sPredelom(browser.close(), ZAKRYTIE_MS, 'Chrome не закрылся');
  } catch (e) {
    try { browser.process()?.kill('SIGKILL'); } catch (e2) { /* процесса уже нет */ }
  }
}

/** Один Chrome на одну печать, в пределах srok; после печати (и после ошибки) Chrome закрыт. */
async function pechatNaOdnomChrome({ zapustit, pechatat, html, srok }) {
  let browser = null;
  let konec = false;
  const rabota = (async () => {
    const b = await zapustit({ srok });
    browser = b;
    // Срок вышел, пока Chrome запускался: печатать уже некому, браузер закрываем здесь
    if (konec) { await zakrytChrome(b); throw new Error('печать снята по сроку'); }
    return pechatat(b, html, { timeout: srok });
  })();
  try {
    return await sPredelom(rabota, srok, `печать не уложилась в ${srok / 1000} с`);
  } finally {
    konec = true;
    if (browser) await zakrytChrome(browser);
  }
}

/**
 * Печатник с очередью. Параметры нужны тестам (подставной запуск и печать без настоящего Chrome).
 * @returns {(html: string) => Promise<Buffer>}
 */
function sozdatPechatnika({ zapustit = zapustitChrome, pechatat = pechatatPdf, maxZhdut = MAX_ZHDUT, srok = SROK_MS } = {}) {
  let zanyato = false;
  const ozhidayut = []; // по порядку: кто ждёт места

  async function vzyatMesto() {
    if (!zanyato) { zanyato = true; return; }
    if (ozhidayut.length >= maxZhdut) throw new PechatZanyata();
    await new Promise((resolve) => { ozhidayut.push(resolve); });
  }
  function otdatMesto() {
    const sleduyushchiy = ozhidayut.shift();
    if (sleduyushchiy) sleduyushchiy(); // место переходит следующему, занято остаётся
    else zanyato = false;
  }

  return async function pechatatSmetu(html) {
    await vzyatMesto();
    try {
      return await pechatNaOdnomChrome({ zapustit, pechatat, html, srok });
    } finally {
      otdatMesto();
    }
  };
}

const pechatatSmetu = sozdatPechatnika();

module.exports = {
  pechatatSmetu,
  sozdatPechatnika,
  zapustitChrome,
  PechatZanyata,
  MAX_ZHDUT,
  SROK_MS,
};
