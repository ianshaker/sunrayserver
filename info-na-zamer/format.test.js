"use strict";

// Ссылка мастеру на Яндекс Карты (домен 13, буква З). Перепутанный порядок цифр молчит: ссылка открывается,
// но метка стоит в другом месте — поэтому сверка на точках с известным ответом.
// Запуск: NODE_OPTIONS=--max-old-space-size=1024 node --test info-na-zamer/

const test = require("node:test");
const assert = require("node:assert/strict");
const { yandexMapsLink } = require("./format");
const { buildClientCard } = require("./messages");

test("ссылка: долгота первой — три точки буквы Б", () => {
  assert.equal(
    yandexMapsLink("55.753960, 37.620393"),
    "https://yandex.ru/maps/?pt=37.620393,55.753960&z=17&l=map",
  );
  assert.equal(
    yandexMapsLink("55.431150, 37.544730"),
    "https://yandex.ru/maps/?pt=37.544730,55.431150&z=17&l=map",
  );
  assert.equal(
    yandexMapsLink("55.183210, 37.491070"),
    "https://yandex.ru/maps/?pt=37.491070,55.183210&z=17&l=map",
  );
});

test("ссылка: нет координат или формат не как в базе — null", () => {
  for (const плохо of [null, undefined, "", "55,753960 37,620393", "55.75396, 37.620393", "55.753960,37.620393"]) {
    assert.equal(yandexMapsLink(плохо), null, String(плохо));
  }
});

test("карточка мастеру: строка «Карта» после «Детальный», без координат — нет строки", () => {
  const поля = {
    header: "ЗАЯВКА НА ЗАМЕР #09778",
    clientName: "Иван",
    phone: "8 900 000-00-00",
    city: "Красногорск",
    address: "ул. Советская, 1, Красногорск (PlaceID: x)",
    detailedAddress: "кв. 45",
    masterName: "СЕМЁН",
  };
  const с = buildClientCard({ ...поля, coordinates: "55.831200, 37.330100" });
  assert.match(
    с,
    /Детальный: кв\. 45\nКарта: https:\/\/yandex\.ru\/maps\/\?pt=37\.330100,55\.831200&z=17&l=map\n/,
  );
  assert.doesNotMatch(buildClientCard(поля), /Карта:/);
});
