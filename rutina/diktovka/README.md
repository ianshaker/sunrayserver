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
`FST_ERR_CTP_ALREADY_PRESENT` и падение всего сервера. 10 МБ при 32 кбит/с —
с большим запасом на 5 минут записи браузера; base64 (×4/3) остаётся ниже
20 МБ inline-запроса Vertex. Тайм-аут 45 с — меньше 60 с ожидания браузера.

**Модель.** `gemini-3.5-flash-lite`, Vertex `global`; на 404 — запасная
`gemini-3-flash-preview`. Без `temperature`/`thinkingBudget` (3.x). Ответ —
JSON по схеме `{ status: "ok" | "empty", text }`, `maxOutputTokens` 8192.
Инструкция — в `diktovka.js` (`INSTRUKCIYA`).

**Журнал.** События `diktovka_ok`, `diktovka_tishina`, `diktovka_sboy`,
`google_sboy`, `google_dolgo`: тип, байты, мс, знаков, модель, статус, код.
Ни аудио, ни текста, ни токенов.

**Чем проверено.** `diktovka.test.js` — чистые функции; `../testy/kak-sunray.test.js`
— адреса на сервере «как Sunray» через `inject`. Живой Google — только после
выкатки, на пробном аудио.
