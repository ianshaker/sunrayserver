"use strict";

// Единственная точка входа RUTINA на сервере Sunray.
// server.js подключает её одной строкой после CORS и до listen:
//   require("./rutina")(fastify);
// Всё наше — внутри области /rutina: хуки, обработчик ошибок, разборы тела
// и пределы корень Sunray не задевают. На корневой fastify ничего не вешаем.

const { otvetitOshibkoy, kodPoOshibke, zhurnalPoUmolchaniyu } = require("./obshchee/otvety");

// Логики области — их адреса. /rutina/zdorov сверяет, что каждый встал:
// сбой одной логики обёртка Ы24 гасит молча, и без этой сверки «здоров»
// отвечал бы 200 при мёртвой диктовке (проверка П-Б, находка 08).
// Новая логика — строка здесь и своя регистрация ниже.
const LOGIKI = [{ imya: "diktovka", metod: "POST", adres: "/diktovka" }];

// nastroyki — только для тестов: { vhod, google, zhurnal }.
function podklyuchitRutinu(fastify, nastroyki = {}) {
  const zhurnal = nastroyki.zhurnal || zhurnalPoUmolchaniyu;

  async function oblastRutiny(app) {
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

    app.register(require("./zdorov"), { logiki: LOGIKI });
    app.register(require("./diktovka"), { vhod, google, zhurnal });
  }

  // Наш сбой не роняет Sunray (Ы24): ошибка загрузки области (require,
  // повтор разбора тела, опечатка) иначе ушла бы в ready → listen →
  // process.exit(1) в server.js. Обёртка без адресов — своя область вокруг
  // /rutina: её after видит ошибки только нашей области, а не плагинов
  // Sunray до нас (их сбой роняет сервер, как и раньше). Колбэк — строго с
  // двумя аргументами: с одним Fastify ошибку не гасит. В журнал — только код.
  fastify.register(async function obertkaRutiny(obertka) {
    obertka.register(oblastRutiny, { prefix: "/rutina" });
    obertka.after((oshibka, gotovo) => {
      if (oshibka) {
        zhurnal("oblast_ne_vstala", { kod: typeof oshibka.code === "string" ? oshibka.code.slice(0, 60) : null });
      }
      gotovo();
    });
  });
}

module.exports = podklyuchitRutinu;
module.exports.LOGIKI = LOGIKI;
