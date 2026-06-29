// Периодический digest вместо спама «каждую минуту всё ок».
function createQuietDigest(prefix, every = 30) {
  let quiet = 0;
  return {
    onQuiet() {
      quiet += 1;
      if (quiet >= every) {
        console.log(`${prefix} ${quiet} проверок подряд — новых событий нет`);
        quiet = 0;
      }
    },
    onActivity() {
      quiet = 0;
    },
  };
}

module.exports = { createQuietDigest };
