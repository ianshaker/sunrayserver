const fs = require("fs");
const path = require("path");


/**
 * Регистрирует endpoint для обновления файла contractsfinalnew.json
 * POST /update-contracts
 * Тело запроса — JSON массив договоров (array of objects)
 */
function registerContractsUpdateRoute(fastify) {
  fastify.post("/update-contracts", async (request, reply) => {
    try {
      const contracts = request.body;
      if (!Array.isArray(contracts)) {
        return reply.code(400).send({ status: "error", message: "Данные должны быть массивом!" });
      }

      const filePath = path.join(__dirname, "contractsfinalnew.json");

      // 1. Читаем существующий массив из файла (если пустой — делаем [])
      let existingContracts = [];
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, "utf8");
        if (fileContent.trim()) {
          existingContracts = JSON.parse(fileContent);
        }
      }

      // 2. Создаём Set для быстрых проверок по appeal_id
      const existingIds = new Set(existingContracts.map(c => String(c.appeal_id)));

      // 3. Фильтруем новые договоры (которых нет по id)
      const newContracts = [];
      let duplicates = 0;
      for (const contract of contracts) {
        const id = String(contract.appeal_id);
        if (!existingIds.has(id)) {
          newContracts.push(contract);
          existingIds.add(id);
        } else {
          duplicates++;
        }
      }

      // 4. Обновляем массив и сохраняем обратно
      const updatedContracts = existingContracts.concat(newContracts);
      fs.writeFileSync(filePath, JSON.stringify(updatedContracts, null, 2), "utf8");

      reply.send({
        status: "ok",
        message: `Добавлено новых договоров: ${newContracts.length}, пропущено (уже были): ${duplicates}`,
        added: newContracts.length,
        skipped: duplicates,
        total: updatedContracts.length
      });
    } catch (err) {
      reply.code(500).send({ status: "error", message: err.message });
    }
  });
}

module.exports = { registerContractsUpdateRoute };