"use strict";

// Единственная точка входа RUTINA на сервере Sunray.
// server.js подключает её одной строкой после CORS и до listen:
//   require("./rutina")(fastify);
// Всё наше — внутри области /rutina: хуки, обработчик ошибок, разборы тела
// и пределы корень Sunray не задевают. На корневой fastify ничего не вешаем.

const { otvetitOshibkoy, kodPoOshibke, zhurnalPoUmolchaniyu } = require("./obshchee/otvety");

// nastroyki — только для тестов: { vhod, google, zhurnal }.
function podklyuchitRutinu(fastify, nastroyki = {}) {
  fastify.register(
    async function oblastRutiny(app) {
      const zhurnal = nastroyki.zhurnal || zhurnalPoUmolchaniyu;
      const vhod = nastroyki.vhod || require("./obshchee/vhod").sozdatVhod({ zhurnal });
      const google = nastroyki.google || require("./obshchee/google").sozdatGoogle({ zhurnal });

      app.setErrorHandler(function (oshibka, _request, reply) {
        const kod = kodPoOshibke(oshibka);
        if (kod === "sboy") {
          // Только код и статус: сообщение и сама ошибка могут нести данные.
          zhurnal("oblast_sboy", {
            kod: oshibka && typeof oshibka.code === "string" ? oshibka.code.slice(0, 60) : null,
            status: oshibka && typeof oshibka.statusCode === "number" ? oshibka.statusCode : null,
          });
        }
        return otvetitOshibkoy(reply, kod);
      });

      app.register(require("./zdorov"));
      app.register(require("./diktovka"), { vhod, google, zhurnal });
    },
    { prefix: "/rutina" },
  );
}

module.exports = podklyuchitRutinu;
