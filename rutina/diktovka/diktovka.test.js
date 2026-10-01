"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  TIPY,
  PREDEL_ZNAKOV,
  osnovaTipa,
  sobratZapros,
  pochistitTekst,
  razobratOtvet,
  tokenyIz,
  raspoznat,
} = require("./diktovka");
const { googleOtvechaet } = require("../testy/pomoshchniki");

function otvetModeli(tekst, finishReason = "STOP", lishnee = {}) {
  return { candidates: [{ finishReason, content: { parts: [{ text: tekst }] } }], ...lishnee };
}

test("белый список: четыре типа, без audio/mpeg", () => {
  assert.deepEqual(TIPY, ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"]);
  assert.equal(osnovaTipa("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(osnovaTipa("Audio/MP4"), "audio/mp4");
  assert.equal(osnovaTipa("audio/ogg; codecs=opus"), "audio/ogg");
  assert.equal(osnovaTipa("audio/wav"), "audio/wav");
  assert.equal(osnovaTipa("audio/mpeg"), null);
  assert.equal(osnovaTipa("audio/wave"), null);
  assert.equal(osnovaTipa("audio/flac"), null);
  assert.equal(osnovaTipa("application/json"), null);
  assert.equal(osnovaTipa(undefined), null);
});

test("запрос: основа типа, base64, схема ответа, без temperature", () => {
  const telo = sobratZapros(Buffer.from("abc"), "audio/webm");
  const chast = telo.contents[0].parts[0];
  assert.deepEqual(chast, { inlineData: { mimeType: "audio/webm", data: "YWJj" } });
  assert.equal(telo.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(telo.generationConfig.responseSchema.required, ["status", "text"]);
  assert.equal(telo.generationConfig.maxOutputTokens, 8192);
  assert.equal("temperature" in telo.generationConfig, false);
  assert.equal("thinkingConfig" in telo.generationConfig, false);
  const instrukciya = telo.systemInstruction.parts[0].text;
  assert.match(instrukciya, /дословно/);
  assert.match(instrukciya, /пустой строкой/);
  assert.match(instrukciya, /empty/);
});

test("ответ ok — чистый текст", () => {
  assert.deepEqual(razobratOtvet(otvetModeli('{"status":"ok","text":"Привет, мир."}')), {
    status: "ok",
    text: "Привет, мир.",
  });
});

test("ответ в ограде ``` — тоже разбирается", () => {
  const itog = razobratOtvet(otvetModeli('```json\n{"status":"ok","text":"Да."}\n```'));
  assert.equal(itog.text, "Да.");
});

test("мысли модели (thought) в текст не попадают", () => {
  const data = {
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: "думаю…", thought: true }, { text: '{"status":"ok","text":"Слово."}' }] },
      },
    ],
  };
  assert.equal(razobratOtvet(data).text, "Слово.");
});

test("тишина: empty, пустой текст, одни пробелы", () => {
  assert.equal(razobratOtvet(otvetModeli('{"status":"empty","text":""}')).status, "empty");
  assert.equal(razobratOtvet(otvetModeli('{"status":"ok","text":"  \\n\\n "}')).status, "empty");
});

test("SAFETY, RECITATION, MAX_TOKENS, блок, не JSON — golos_sboy с причиной", () => {
  const sluchai = [
    [otvetModeli("{}", "SAFETY"), "safety"],
    [otvetModeli("{}", "RECITATION"), "recitation"],
    [otvetModeli('{"status":"ok","text":"обры', "MAX_TOKENS"), "max_tokens"],
    [{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }, "blok_prohibited_content"],
    [{ candidates: [] }, "net_kandidata"],
    [otvetModeli("просто текст"), "ne_json"],
    [otvetModeli('{"status":"da","text":"x"}'), "ne_po_sheme"],
    [otvetModeli('{"status":"ok","text":5}'), "ne_po_sheme"],
    [null, "pustoy_otvet"],
  ];
  for (const [data, prichina] of sluchai) {
    assert.throws(
      () => razobratOtvet(data),
      (o) => o.kod === "golos_sboy" && o.prichina === prichina,
      prichina,
    );
  }
});

test("чистка: переводы строк, тройные переносы, предел длины", () => {
  assert.equal(pochistitTekst("Раз.\r\n\r\n\r\n\r\nДва.  \nТри."), "Раз.\n\nДва.\nТри.");
  assert.equal(pochistitTekst("а".repeat(PREDEL_ZNAKOV + 50)).length, PREDEL_ZNAKOV);
  const sEmodzi = "а".repeat(PREDEL_ZNAKOV - 1) + "😀";
  const obrezan = pochistitTekst(sEmodzi + "хвост");
  assert.equal(obrezan.length, PREDEL_ZNAKOV - 1, "суррогатная пара не рвётся");
});

test("распознать: зовёт модель с длиной аудио, отдаёт текст и модель", async () => {
  const google = googleOtvechaet({ status: "ok", text: "Абзац один.\n\n\n\nАбзац два." });
  const itog = await raspoznat({ audio: Buffer.from("zvuk"), tip: "audio/mp4", google });
  assert.deepEqual(itog, {
    status: "ok",
    text: "Абзац один.\n\nАбзац два.",
    model: "testovaya",
    tokeny: { tokenovMysli: null, tokenovOtveta: null },
  });
  assert.equal(google.vyzovy[0].opts.dlinaZaprosa, 4);
  assert.equal(google.vyzovy[0].telo.contents[0].parts[0].inlineData.mimeType, "audio/mp4");
});

test("токены рассуждения и ответа — только числа для журнала (ревью Г-1, Н2)", async () => {
  assert.deepEqual(tokenyIz({ usageMetadata: { thoughtsTokenCount: 812, candidatesTokenCount: 140, promptTokenCount: 9 } }), {
    tokenovMysli: 812,
    tokenovOtveta: 140,
  });
  assert.deepEqual(tokenyIz({}), { tokenovMysli: null, tokenovOtveta: null });
  assert.deepEqual(tokenyIz({ usageMetadata: { thoughtsTokenCount: "много" } }), { tokenovMysli: null, tokenovOtveta: null });
  // MAX_TOKENS: ошибка несёт модель и токены — журнал покажет, что съело предел
  const google = {
    async sprositModel() {
      return {
        model: "zapasnaya",
        data: { ...otvetModeli('{"status":"ok","text":"обры', "MAX_TOKENS"), usageMetadata: { thoughtsTokenCount: 8000, candidatesTokenCount: 192 } },
      };
    },
  };
  await assert.rejects(raspoznat({ audio: Buffer.from("z"), tip: "audio/webm", google }), (o) => {
    assert.equal(o.prichina, "max_tokens");
    assert.equal(o.model, "zapasnaya");
    assert.deepEqual(o.tokeny, { tokenovMysli: 8000, tokenovOtveta: 192 });
    return true;
  });
});
