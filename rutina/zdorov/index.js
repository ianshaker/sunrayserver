"use strict";

// GET /rutina/zdorov — жива ли область RUTINA. Без входа и без данных.

async function zdorov(app) {
  app.get("/zdorov", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok" };
  });
}

module.exports = zdorov;
