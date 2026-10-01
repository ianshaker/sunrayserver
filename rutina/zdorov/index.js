"use strict";

// GET /rutina/zdorov — жива ли область RUTINA и встал ли адрес каждой логики.
// Без входа и без данных. Всё встало — 200 { status: "ok", logiki: {…: true} };
// хоть одной нет — 503 { status: "ne_vse", logiki: { diktovka: false } }.
// Сверка — по самому маршрутизатору (hasRoute), а не флагом: адрес мог не
// встать и после тела плагина. Без неё частичный сбой области (Ы24 гасит
// его молча) был тихим: «здоров» 200, а диктовка 404 (проверка П-Б, 08).

async function zdorov(app, { logiki = [] } = {}) {
  app.get("/zdorov", async (_request, reply) => {
    const vstali = {};
    for (const logika of logiki) {
      vstali[logika.imya] = app.hasRoute({ method: logika.metod, url: app.prefix + logika.adres });
    }
    const vse = Object.values(vstali).every(Boolean);
    reply.header("cache-control", "no-store");
    reply.code(vse ? 200 : 503);
    return { status: vse ? "ok" : "ne_vse", logiki: vstali };
  });
}

module.exports = zdorov;
