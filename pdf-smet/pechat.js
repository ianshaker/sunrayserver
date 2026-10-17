/**
 * HTML → PDF для смет (PLANS/SERVER/05-pdf-smet, буква А).
 *
 * Браузер приходит параметром, здесь его не запускают и не подключают: в пробе на Mac это установленный Google
 * Chrome, на сервере (буква Б) — Chrome сервера. Опции печати те же, что у Api2Pdf в старой функции
 * (generate-estimate-pdf/index.ts:52-62): A4, фон печатается, поля нулевые.
 */

const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
};

/**
 * @param {import('puppeteer-core').Browser} browser — уже запущенный браузер (puppeteer / puppeteer-core)
 * @param {string} html — готовая страница, из shablon.buildHtml
 * @param {{ timeout?: number }} [options] — предел в миллисекундах на загрузку страницы и на саму печать
 * @returns {Promise<Buffer>} — PDF
 */
async function pechatatPdf(browser, html, { timeout = 30000 } = {}) {
  const page = await browser.newPage();
  try {
    // Ждём сеть (шрифт, обложка, печать) и шрифты: иначе смета выйдет другим шрифтом
    await page.setContent(html, { waitUntil: 'networkidle0', timeout });
    await page.evaluate(async () => { await document.fonts.ready; });
    const pdf = await page.pdf({ ...PDF_OPTIONS, timeout });
    return Buffer.from(pdf);
  } finally {
    // Ошибка закрытия не должна затирать ошибку печати (или превращать готовый PDF в отказ)
    await page.close().catch(() => {});
  }
}

module.exports = { pechatatPdf, PDF_OPTIONS };
