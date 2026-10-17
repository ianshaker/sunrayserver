"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sozdatZamok } = require("./zamokProksi");

const NASH_IP = "135.106.155.17";
const CHUZHOY_IP = "8.8.8.8";
const SEKRET = "SEKRET-PROKSI-d41d8cd9";
// Неверный заголовок той же длины, что и секрет, и отличается одним знаком: проверяет само сравнение, а не длину.
const NEVERNYY = "SEKRET-PROKSI-d41d8cd0";

const TREBOVAT = { MANGO_PROXY_SECRET: SEKRET, MANGO_PROXY_SECRET_REQUIRED: "1" };
const TOLKO_SEKRET = { MANGO_PROXY_SECRET: SEKRET };

// Подмена журнала: собирает вызовы всех уровней.
function zhurnal() {
  const vyzovy = [];
  const log = {};
  for (const uroven of ["trace", "debug", "info", "warn", "error", "fatal"]) {
    log[uroven] = (...args) => {
      vyzovy.push({ uroven, args });
    };
  }
  return { log, vyzovy };
}

function predupezhdeniya(vyzovy) {
  return vyzovy.filter((v) => v.uroven === "warn").map((v) => v.args.join(" "));
}

// Подмена запроса Fastify: только то, что читает замок.
function zapros({ xff, ip, zagolovok } = {}) {
  const headers = {};
  if (xff !== undefined) headers["x-forwarded-for"] = xff;
  if (zagolovok !== undefined) headers["x-proxy-secret"] = zagolovok;
  return { headers, ip };
}

// Подмена ответа Fastify: code().send() запоминает код и тело.
function otvet() {
  const o = { kod: null, telo: null, otpravlen: false };
  o.code = (kod) => {
    o.kod = kod;
    return o;
  };
  o.send = (telo) => {
    o.telo = telo;
    o.otpravlen = true;
    return o;
  };
  return o;
}

// Прогон замка; падение замка — это падение теста.
async function progon(env, req, log) {
  const reply = otvet();
  await assert.doesNotReject(sozdatZamok({ env, log })(req, reply));
  return reply;
}

function utverditPropusk(reply) {
  assert.equal(reply.otpravlen, false, "ответ отправлен, а запрос должен пройти дальше");
  assert.equal(reply.kod, null);
}

function utverdit403(reply) {
  assert.equal(reply.kod, 403);
  assert.deepEqual(reply.telo, { error: "Forbidden" });
}

test("а) секрета в env нет — прежнее поведение: наш адрес в XFF пропущен, чужой — 403", async () => {
  const { log, vyzovy } = zhurnal();

  utverditPropusk(await progon({}, zapros({ xff: NASH_IP }), log));
  // берётся первое значение XFF — как раньше
  utverditPropusk(await progon({}, zapros({ xff: `${NASH_IP}, ${CHUZHOY_IP}` }), log));
  assert.equal(vyzovy.length, 0);

  utverdit403(await progon({}, zapros({ xff: CHUZHOY_IP }), log));
  assert.deepEqual(predupezhdeniya(vyzovy), [`Mango webhook rejected from IP: ${CHUZHOY_IP}`]);

  // Без log в замке предупреждение идёт в req.log, как раньше.
  const reqLog = zhurnal();
  const reply = otvet();
  await sozdatZamok({ env: {} })({ ...zapros({ xff: CHUZHOY_IP }), log: reqLog.log }, reply);
  utverdit403(reply);
  assert.deepEqual(predupezhdeniya(reqLog.vyzovy), [`Mango webhook rejected from IP: ${CHUZHOY_IP}`]);
});

test("б) секрет есть, заголовок верный, адрес чужой — пропуск", async () => {
  const { log, vyzovy } = zhurnal();
  const req = zapros({ xff: CHUZHOY_IP, zagolovok: SEKRET });

  utverditPropusk(await progon(TOLKO_SEKRET, req, log));

  assert.equal(req.mangoProxySecretOk, true);
  assert.equal(vyzovy.length, 0);
});

test("в) секрет есть, заголовок неверный (или не пришёл), адрес наш, не «требовать» — пропуск и предупреждение «без секрета»", async () => {
  for (const zagolovok of [NEVERNYY, undefined]) {
    const { log, vyzovy } = zhurnal();
    const req = zapros({ xff: NASH_IP, zagolovok });

    utverditPropusk(await progon(TOLKO_SEKRET, req, log));

    assert.notEqual(req.mangoProxySecretOk, true);
    assert.deepEqual(predupezhdeniya(vyzovy), ["замок прокси: запрос без секрета, пропущен по адресу"]);
    assert.ok(predupezhdeniya(vyzovy)[0].includes("без секрета"));
  }
});

test("г) «требовать», заголовка нет, адрес наш (подделанный XFF) — 403", async () => {
  const { log, vyzovy } = zhurnal();
  const req = zapros({ xff: NASH_IP });

  utverdit403(await progon(TREBOVAT, req, log));

  assert.notEqual(req.mangoProxySecretOk, true);
  assert.deepEqual(predupezhdeniya(vyzovy), ["замок прокси: без секрета/не совпал"]);
});

test("д) «требовать», заголовок верный — пропуск", async () => {
  const { log, vyzovy } = zhurnal();
  const req = zapros({ ip: CHUZHOY_IP, zagolovok: SEKRET });

  utverditPropusk(await progon(TREBOVAT, req, log));

  assert.equal(req.mangoProxySecretOk, true);
  assert.equal(vyzovy.length, 0);
});

test("е) «требовать», а секрета в env нет — 403, даже с нашим адресом и пустым заголовком", async () => {
  const bezSekreta = [
    { MANGO_PROXY_SECRET_REQUIRED: "1" },
    { MANGO_PROXY_SECRET: "", MANGO_PROXY_SECRET_REQUIRED: "1" },
  ];

  for (const env of bezSekreta) {
    for (const zagolovok of [undefined, "", NEVERNYY]) {
      const { log, vyzovy } = zhurnal();
      const req = zapros({ xff: NASH_IP, zagolovok });

      utverdit403(await progon(env, req, log));

      assert.notEqual(req.mangoProxySecretOk, true);
      assert.deepEqual(predupezhdeniya(vyzovy), ["замок прокси: без секрета/не совпал"]);
    }
  }
});

test("ж) заголовок другой длины — не падает, считается «не совпал»", async () => {
  const drugoyDliny = [
    SEKRET.slice(0, -1),
    `${SEKRET}x`,
    "",
    "x",
    // столько же символов, но вдвое больше байт: длину надо сверять по байтам
    "ё".repeat(SEKRET.length),
  ];

  for (const zagolovok of drugoyDliny) {
    // «требовать»: 403
    const reqT = zapros({ xff: NASH_IP, zagolovok });
    utverdit403(await progon(TREBOVAT, reqT, zhurnal().log));
    assert.notEqual(reqT.mangoProxySecretOk, true);

    // не «требовать»: пропуск только по адресу, секрет не засчитан
    const { log, vyzovy } = zhurnal();
    const reqA = zapros({ xff: NASH_IP, zagolovok });
    utverditPropusk(await progon(TOLKO_SEKRET, reqA, log));
    assert.notEqual(reqA.mangoProxySecretOk, true);
    assert.deepEqual(predupezhdeniya(vyzovy), ["замок прокси: запрос без секрета, пропущен по адресу"]);
  }
});

test("з) секрет и значения заголовка не попадают ни в одну строку лога", async () => {
  const { log, vyzovy } = zhurnal();
  const DRUGOY = "ZAGOLOVOK-BEZ-SEKRETA-123";
  const stsenarii = [
    // неверный заголовок, наш адрес, не «требовать»: пропуск с предупреждением
    [TOLKO_SEKRET, zapros({ xff: NASH_IP, zagolovok: NEVERNYY })],
    // неверный заголовок, чужой адрес: 403 по адресу
    [TOLKO_SEKRET, zapros({ xff: CHUZHOY_IP, zagolovok: NEVERNYY })],
    // «требовать», неверный заголовок: 403
    [TREBOVAT, zapros({ xff: NASH_IP, zagolovok: NEVERNYY })],
    // «требовать», секрета в env нет, заголовок какой-то: 403
    [{ MANGO_PROXY_SECRET_REQUIRED: "1" }, zapros({ xff: NASH_IP, zagolovok: DRUGOY })],
    // верный заголовок: пропуск
    [TOLKO_SEKRET, zapros({ xff: CHUZHOY_IP, zagolovok: SEKRET })],
    [TREBOVAT, zapros({ zagolovok: SEKRET })],
  ];

  for (const [env, req] of stsenarii) {
    await progon(env, req, log);
  }

  // Журнал не пустой — иначе проверка ниже ничего бы не доказывала.
  assert.ok(predupezhdeniya(vyzovy).length >= 4);
  const tekst = JSON.stringify(vyzovy);
  assert.ok(!tekst.includes(SEKRET), "секрет попал в журнал");
  assert.ok(!tekst.includes(NEVERNYY), "значение заголовка попало в журнал");
  assert.ok(!tekst.includes(DRUGOY), "значение заголовка попало в журнал");
});
