const { supabase } = require("../lib/supabaseClient");
const { CONTRACT_SCAN_BUCKET } = require("./config");

async function downloadContractScan(path) {
  const { data, error } = await supabase.storage
    .from(CONTRACT_SCAN_BUCKET)
    .download(path);

  if (error) {
    throw new Error(`Storage download failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Storage download returned empty file");
  }

  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * @param {Array<{ role?: string, path: string, order?: number }>} pages
 * @returns {Promise<Array<{ role: string, path: string, order: number, buffer: Buffer }>>}
 */
async function downloadContractScanPages(pages) {
  const list = Array.isArray(pages) ? [...pages] : [];
  const normalized = list
    .filter((p) => p && typeof p.path === "string" && p.path.trim())
    .map((p, i) => ({
      role: typeof p.role === "string" ? p.role : "main",
      path: p.path.trim(),
      order: typeof p.order === "number" ? p.order : i,
    }))
    .sort((a, b) => a.order - b.order);

  if (normalized.length === 0) {
    throw new Error("Нет страниц скана для скачивания");
  }

  const result = [];
  for (const page of normalized) {
    const buffer = await downloadContractScan(page.path);
    if (!buffer.length) {
      const err = new Error(`Пустой файл скана: ${page.path}`);
      err.statusCode = 404;
      throw err;
    }
    result.push({ ...page, buffer });
  }
  return result;
}

module.exports = {
  downloadContractScan,
  downloadContractScanPages,
};
