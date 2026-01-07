const fs = require("fs");
const path = require("path");

// Функция для удаления дубликатов (не выполняется автоматически)
function removeDuplicates() {
  const filePath = path.join(__dirname, "contractsfinalnew.json");

  // Читаем файл
  let contracts = [];
  try {
    const fileContent = fs.readFileSync(filePath, "utf8");
    contracts = JSON.parse(fileContent);
  } catch (err) {
    console.error("Ошибка чтения файла:", err.message);
    return;
  }

  // Удаляем дубликаты по appeal_id
  const seen = new Set();
  const uniqueContracts = [];

  for (const contract of contracts) {
    const id = contract.appeal_id;
    if (!seen.has(id)) {
      uniqueContracts.push(contract);
      seen.add(id);
    }
  }

  // Сортировка по dogovor_date — от новых к старым
  uniqueContracts.sort((a, b) => {
    // null/undefined/пустые — в конец
    if (!a.dogovor_date) return 1;
    if (!b.dogovor_date) return -1;
    // Сортировка по дате (новые сверху)
    return new Date(b.dogovor_date) - new Date(a.dogovor_date);
  });

  try {
    fs.writeFileSync(filePath, JSON.stringify(uniqueContracts, null, 2), "utf8");
    console.log(
      `Дубликаты удалены и записи отсортированы: было ${contracts.length}, стало ${uniqueContracts.length}.`
    );
  } catch (err) {
    console.error("Ошибка записи файла:", err.message);
  }
}

// Экспортируем функцию, но не вызываем её автоматически
module.exports = removeDuplicates;