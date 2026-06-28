const fs = require("fs");
const { CONTRACTS_PATH } = require("../config");

function findContractByPhoneFromFile(phone) {
  try {
    if (!fs.existsSync(CONTRACTS_PATH)) return null;
    const contracts = JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
    const clearPhone = phone.replace(/\D/g, "");
    return (
      contracts.find((contract) => {
        const contractPhone = (contract.phone || "").replace(/\D/g, "");
        return contractPhone && contractPhone === clearPhone;
      }) || null
    );
  } catch {
    return null;
  }
}

module.exports = { findContractByPhoneFromFile };
