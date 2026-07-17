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

module.exports = {
  downloadContractScan,
};
