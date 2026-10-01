# rutina/ — угол RUTINA на сервере Sunray

Личное приложение RUTINA (https://rutina.ink) держит здесь логики, которым
мало Vercel. Мы гости: всё наше — в этой папке, снаружи — одна строка в
`server.js`:

```js
require("./rutina")(fastify);   // после CORS, до listen
```

Законы гостя (скиллы RUTINA `/10-1-sunray`, `/10-2-sunray-logika`):

- Код Sunray (`call-ai/`, `lib/`, `assistant/`, их клиенты Google, Supabase,
  Telegram) не вызываем и не импортируем. Пакеты — только уже стоящие у Sunray
  и встроенные Node; `package.json` не трогаем.
- Переменные Sunray только читаем (`GOOGLE_APPLICATION_CREDENTIALS_JSON`).
  Своих секретов нет.
- Адреса — только `/rutina/…`, хуки, обработчик ошибок и разборы тела —
  внутри своей области Fastify. Ни `process.exit`, ни глобальных
  обработчиков, ни фоновых работников.
- В журнал — только длины, мс и коды. Ни аудио, ни текстов, ни токенов входа
  (число токенов модели — можно: это счёт, а не данные).
- Вход пускает любого вошедшего в RUTINA (роль `authenticated`, непустой
  `sub`), конкретный `sub` не сверяется: ворота держит список допуска базы
  RUTINA — без записи туда никто не войдёт.
- Отправка в `main` — выкатка Render, только словом Яна, каждый раз.

## Устройство

```
rutina/
  index.js            область /rutina: setErrorHandler, zdorov, diktovka;
                      сбой загрузки области гасится обёрткой — Sunray жив (Ы24);
                      LOGIKI — адреса логик, их сверяет zdorov
  obshchee/
    otvety.js         ответы ошибок { oshibka: "<код>" }, журнал
    vhod.js           «это вход RUTINA»: ES256 по JWKS базы RUTINA, crypto Node
    google.js         свой клиент Google (googleapis), Gemini на Vertex global
  zdorov/             GET /rutina/zdorov — 200, если адрес каждой логики
                      встал; 503 { status: "ne_vse", logiki } — если нет
  diktovka/           POST /rutina/diktovka — голос → текст
  testy/              сервер «как Sunray» и помощники тестов
```

## Проверка

```
node --test "rutina/**/*.test.js"
```

Глобом: `node --test rutina/` грузит папку модулем и даёт ложную зелень.
Тест `testy/kak-sunray.test.js` собирает корень как в `server.js`
(bodyLimit 55 МБ, cors `origin: '*'`, formbody, корневой разбор `audio/mpeg`),
ставит нашу область и зовёт `ready()` — падение здесь, а не на Render.
Google и JWKS в тестах — подменой, живых вызовов нет.

## После выкатки

`GET /rutina/zdorov` — не только `/ping`: Sunray жив и при сбое нашей
области (Ы24), а сбой одной логики виден только здесь — `503` и
`logiki: { diktovka: false }` — и строкой `oblast_ne_vstala` в журнале.

## Наши логики

Здесь — что есть и с какого коммита. Какой коммит стоит на Render сейчас и
что ждёт выкатки — реестр в скилле RUTINA `/10-2-sunray-logika`, «Наши
логики»: правка этого файла — новая отправка в `main`, то есть новая
выкатка, и коммит своего же хеша знать не может (проверка П-Б, находка 09).

| Логика | Адрес | Что делает | Чем | Впервые на сервере |
|---|---|---|---|---|
| `zdorov` | `GET /rutina/zdorov` | жива ли область RUTINA и встала ли каждая логика | — | `5de6caf`, выкачена 01.10.2026 |
| `diktovka` | `POST /rutina/diktovka` | голос Яна → текст для мысли Reels (Г-1) | Gemini на Vertex, свой клиент | `5de6caf`, выкачена 01.10.2026 |
