const activeCalls = {}; // call_id: инфо о звонке
const entryCallMeta = {}; // entry_id: данные с этапа IVR (номер линии до дозвона)

// Последняя живая карточка на номер: { card, callData, foundInfoList, createdAppealId, crmPhase, errorNote, finished, entryId }.
// Телефон — только индекс «последняя сессия»; сессию своего звонка событие ищет по entry_id (см. sessiyaTogoZheZvonka).
const callMessages = {};

// Отложенные сессии: entry_id -> { session, vremya }. Сессия живого звонка, которую на номере вытеснил другой звонок
// (клиент перезвонил, пока итог первого не пришёл; два звонка со скрытого номера делят ключ «Неизвестный номер»).
// Итог, Connected, Disconnected и второе плечо дозвона первого звонка находят её по entry_id.
// Срок записи — 30 минут от последнего обращения (запись или нахождение сессии по entry_id): звонок, события которого
// идут, не теряет сессию; запись, к которой не обращались 30 минут, выбрасывается при следующей записи, таймеров нет.
const OTLOZHENNAYA_PAMYAT_MS = 30 * 60 * 1000;
const otlozhennyeSessii = new Map();

function otlozhitSessiyu(session, teper = Date.now()) {
    const entryId = session?.entryId;
    if (typeof entryId !== "string" || !entryId) return;
    for (const [kluch, zapis] of otlozhennyeSessii) {
        if (teper - zapis.vremya > OTLOZHENNAYA_PAMYAT_MS) otlozhennyeSessii.delete(kluch);
    }
    otlozhennyeSessii.set(entryId, { session, vremya: teper });
}

function dostatOtlozhennuyu(entryId, teper = Date.now()) {
    if (typeof entryId !== "string" || !entryId) return undefined;
    const zapis = otlozhennyeSessii.get(entryId);
    if (!zapis || teper - zapis.vremya > OTLOZHENNAYA_PAMYAT_MS) return undefined;
    zapis.vremya = teper; // обращение продлевает срок
    return zapis.session;
}

function zabytOtlozhennuyu(entryId) {
    otlozhennyeSessii.delete(entryId);
}

// Память «звонок уже закончен»: entry_id -> время итога (мс). Опоздавший Appeared этого звонка живую сессию не заводит.
// Записи старше 30 минут выбрасываются при следующей записи, таймеров нет.
const ZVONOK_ZAVERSHEN_PAMYAT_MS = 30 * 60 * 1000;
const zavershennyeZvonki = new Map();

function otmetitZavershenie(entryId, teper = Date.now()) {
    if (typeof entryId !== "string" || !entryId) return;
    for (const [kluch, vremya] of zavershennyeZvonki) {
        if (teper - vremya > ZVONOK_ZAVERSHEN_PAMYAT_MS) zavershennyeZvonki.delete(kluch);
    }
    zavershennyeZvonki.set(entryId, teper);
}

function zvonokUzheZavershen(entryId, teper = Date.now()) {
    if (typeof entryId !== "string" || !entryId) return false;
    const vremya = zavershennyeZvonki.get(entryId);
    return vremya !== undefined && teper - vremya <= ZVONOK_ZAVERSHEN_PAMYAT_MS;
}

module.exports = {
    activeCalls,
    entryCallMeta,
    callMessages,
    zavershennyeZvonki,
    otmetitZavershenie,
    zvonokUzheZavershen,
    otlozhennyeSessii,
    otlozhitSessiyu,
    dostatOtlozhennuyu,
    zabytOtlozhennuyu,
};
