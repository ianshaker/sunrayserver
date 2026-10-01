"use strict";

// POST /rutina/diktovka — голос Яна → текст для мысли Reels (Г-1).
// Тело — сырое аудио (audio/webm, audio/mp4, audio/ogg, audio/wav),
// Authorization: Bearer <токен входа RUTINA>. Ответ 200 — { status: "ok", text }.

const { OshibkaRutiny, otvetitOshibkoy } = require("../obshchee/otvety");
const { TIPY, PREDEL_BAYT, osnovaTipa, raspoznat } = require("./diktovka");

async function diktovka(app, { vhod, google, zhurnal }) {
  // Свои разборы — только точные строки из белого списка, внутри своей
  // области: корень Sunray они не задевают (Ы1).
  for (const tip of TIPY) {
    app.addContentTypeParser(tip, { parseAs: "buffer", bodyLimit: PREDEL_BAYT }, (_req, telo, gotovo) => {
      gotovo(null, telo);
    });
  }

  app.post(
    "/diktovka",
    {
      bodyLimit: PREDEL_BAYT,
      // Вход — до разбора тела: без токена аудио даже не читаем.
      onRequest: async (request, reply) => {
        const itog = await vhod.proverit(request.headers.authorization);
        if (!itog.ok) return otvetitOshibkoy(reply, itog.kod);
      },
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string" }, text: { type: "string" } },
            required: ["status", "text"],
          },
        },
      },
    },
    async (request, reply) => {
      const tip = osnovaTipa(request.headers["content-type"]);
      const audio = request.body;
      if (!tip || !Buffer.isBuffer(audio)) return otvetitOshibkoy(reply, "golos_tip");
      if (audio.length === 0) return otvetitOshibkoy(reply, "golos_tishina");

      const nachalo = Date.now();
      try {
        const itog = await raspoznat({ audio, tip, google });
        const ms = Date.now() - nachalo;
        if (itog.status !== "ok") {
          zhurnal("diktovka_tishina", { tip, bayt: audio.length, ms, model: itog.model, ...itog.tokeny });
          return otvetitOshibkoy(reply, "golos_tishina");
        }
        zhurnal("diktovka_ok", { tip, bayt: audio.length, ms, znakov: itog.text.length, model: itog.model, ...itog.tokeny });
        reply.header("cache-control", "no-store");
        return { status: "ok", text: itog.text };
      } catch (oshibka) {
        const ms = Date.now() - nachalo;
        if (oshibka instanceof OshibkaRutiny) {
          zhurnal("diktovka_sboy", {
            kod: oshibka.kod,
            prichina: oshibka.prichina,
            tip,
            bayt: audio.length,
            ms,
            ...(oshibka.model ? { model: oshibka.model } : {}),
            ...(oshibka.tokeny || {}),
          });
          return otvetitOshibkoy(reply, oshibka.kod);
        }
        // Чужая ошибка — только имя, не сообщение и не сама ошибка.
        const imya = oshibka && typeof oshibka.name === "string" ? oshibka.name.slice(0, 40) : null;
        zhurnal("diktovka_sboy", { kod: "golos_sboy", imya, tip, bayt: audio.length, ms });
        return otvetitOshibkoy(reply, "golos_sboy");
      }
    },
  );
}

module.exports = diktovka;
