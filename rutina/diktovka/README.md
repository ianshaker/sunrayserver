# diktovka — голос → текст (RUTINA, Г-1)

`POST /rutina/diktovka`

**Вход.** `Authorization: Bearer <access_token входа RUTINA>`;
`Content-Type` — `audio/webm`, `audio/mp4`, `audio/ogg` или `audio/wav`
(параметры вроде `;codecs=opus` допустимы); тело — сырое аудио, до 10 МБ.

**Выход.** `200 { "status": "ok", "text": "…" }` — расшифровка дословно, с
пунктуацией, абзацы через пустую строку, не длиннее 20 000 знаков.

| Код | `oshibka` | Когда |
|---|---|---|
| 401 | `net_vhoda` | нет токена, подпись не та, истёк, чужой `iss`/`aud`, аноним |
| 503 | `vhod_nedostupen` | JWKS базы RUTINA не отвечает, ключа нет в кэше |
| 413 | `golos_bolshoy` | тело больше 10 МБ |
| 415 | `golos_tip` | тип не из белого списка (в том числе `audio/mpeg`, JSON) |
| 422 | `golos_tishina` | пустое тело или модель не услышала речи (`status: empty`) |
| 502 | `golos_sboy` | модель ответила ошибкой, SAFETY, RECITATION, MAX_TOKENS, не по схеме; нет ключа Google |
| 504 | `golos_dolgo` | модель не ответила за 45 с |

**Пределы и почему.** Разборы тела — только четыре точные строки в своей
области: `audio/mpeg` уже висит на корне Sunray, повтор —
`FST_ERR_CTP_ALREADY_PRESENT`. Сервер Sunray от этого не ляжет — сбой
области гасит обёртка (Ы24), — но диктовка не встанет: адрес 404, а
`GET /rutina/zdorov` — `503 { status: "ne_vse", logiki: { diktovka: false } }`
и строка `oblast_ne_vstala` в журнале. Поэтому после выкатки смотрят
`zdorov`, а не только `/ping`. 10 МБ при 32 кбит/с —
с большим запасом на 5 минут записи браузера; base64 (×4/3) остаётся ниже
20 МБ inline-запроса Vertex. Тайм-аут 45 с — меньше 60 с ожидания браузера.

**Модель.** `gemini-3.5-flash-lite`, Vertex `global`; на 404 — запасная
`gemini-3-flash-preview`. Без `temperature`/`thinkingBudget` (3.x). Ответ —
JSON по схеме `{ status: "ok" | "empty", text }`, `maxOutputTokens` 8192.
Инструкция — в `diktovka.js` (`INSTRUKCIYA`).

**Журнал.** События `diktovka_ok`, `diktovka_tishina`, `diktovka_sboy`,
`google_sboy`, `google_dolgo`: тип, байты, мс, знаков, модель, статус, код;
у ответа модели — `tokenovMysli` и `tokenovOtveta` (числа из
`usageMetadata`). Ни аудио, ни текста, ни токенов входа.

**Смотреть на первом живом вызове** (ревью Г-1, Н2, Н5): не пришёл ли 400 на
`enum` в схеме; сколько `tokenovMysli` у запасной модели — она рассуждает по
умолчанию, и рассуждение ест `maxOutputTokens`: на длинной записи это
`max_tokens` в `diktovka_sboy`. Тогда — `thinkingConfig: { thinkingLevel:
"low" }` для запасной, проверив пробой, что Vertex его принимает.

**Чем проверено.** `diktovka.test.js` — чистые функции; `../testy/kak-sunray.test.js`
— адреса на сервере «как Sunray» через `inject`. Живой Google — только после
выкатки, на пробном аудио.
