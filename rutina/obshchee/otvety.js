"use strict";

// Ответы ошибок области RUTINA — одним видом: { oshibka: "<код>" }.
// Наружу уходит только код: ни текста ошибки, ни подробностей.

const KODY = {
  plokhoy_zapros: 400,
  net_vhoda: 401,
  golos_bolshoy: 413,
  golos_tip: 415,
  golos_tishina: 422,
  sboy: 500,
  golos_sboy: 502,
  vhod_nedostupen: 503,
  golos_dolgo: 504,
};

// Своя ошибка RUTINA: kod — то, что увидит браузер; prichina — короткое
// слово для журнала (статус модели, finishReason). Ни аудио, ни текста,
// ни токенов внутри не бывает.
class OshibkaRutiny extends Error {
  constructor(kod, prichina) {
    super(kod);
    this.name = "OshibkaRutiny";
    this.kod = KODY[kod] ? kod : "sboy";
    this.prichina = prichina || null;
  }
}

function statusKoda(kod) {
  return KODY[kod] || 500;
}

function otvetitOshibkoy(reply, kod) {
  const nastoyashchiy = KODY[kod] ? kod : "sboy";
  return reply
    .code(statusKoda(nastoyashchiy))
    .header("cache-control", "no-store")
    .send({ oshibka: nastoyashchiy });
}

// Ошибка, пришедшая в обработчик области (разбор тела, предел, тип), — в код.
function kodPoOshibke(oshibka) {
  if (oshibka instanceof OshibkaRutiny) return oshibka.kod;
  const kod = oshibka && oshibka.code;
  const status = oshibka && oshibka.statusCode;
  if (kod === "FST_ERR_CTP_BODY_TOO_LARGE" || status === 413) return "golos_bolshoy";
  if (kod === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || status === 415) return "golos_tip";
  if (typeof status === "number" && status >= 400 && status < 500) return "plokhoy_zapros";
  return "sboy";
}

// Журнал области: только событие и короткие поля (длины, мс, коды).
// Сюда никогда не передаются ошибки целиком, тела запросов и заголовки.
function zhurnalPoUmolchaniyu(sobytie, polya) {
  const stroka = `[rutina] ${sobytie}` + (polya ? " " + JSON.stringify(polya) : "");
  console.warn(stroka);
}

module.exports = {
  KODY,
  OshibkaRutiny,
  statusKoda,
  otvetitOshibkoy,
  kodPoOshibke,
  zhurnalPoUmolchaniyu,
};
