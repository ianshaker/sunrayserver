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
- В журнал — только длины, мс и коды. Ни аудио, ни текстов, ни токенов.
- Отправка в `main` — выкатка Render, только словом Яна, каждый раз.

## Устройство

```
rutina/
  index.js            область /rutina: setErrorHandler, zdorov, diktovka
  obshchee/
    otvety.js         ответы ошибок { oshibka: "<код>" }, журнал
    vhod.js           «это вход RUTINA»: ES256 по JWKS базы RUTINA, crypto Node
    google.js         свой клиент Google (googleapis), Gemini на Vertex global
  zdorov/             GET /rutina/zdorov
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

## Наши логики — реестр

Тот же реестр, что в скилле RUTINA `/10-2-sunray-logika`, «Наши логики».

| Логика | Адрес | Что делает | Чем | Коммит на сервере | Дата |
|---|---|---|---|---|---|
| `zdorov` | `GET /rutina/zdorov` | жива ли область RUTINA | — | не выкачена (ветка `rutina-diktovka-2026-10-01`) | — |
| `diktovka` | `POST /rutina/diktovka` | голос Яна → текст для мысли Reels (Г-1) | Gemini на Vertex, свой клиент | не выкачена (ветка `rutina-diktovka-2026-10-01`) | — |
