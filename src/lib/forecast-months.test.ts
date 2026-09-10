import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agruparPorMes, mesDoCorte, type DiaProjetado } from './forecast-months.ts';

/** Série curta e explícita: o acumulado é escrito à mão para o teste não repetir a implementação. */
function dias(...linhas: [string, number, number, number][]): DiaProjetado[] {
  return linhas.map(([day, i, o, b]) => ({
    day,
    in_cents: i,
    out_cents: o,
    balance_cents: b,
  }));
}

test('saldo do mês é o do ÚLTIMO dia, nunca a soma dos dias', () => {
  // `balance_cents` já vem acumulado: somar 100+100+100 daria 300 e o saldo é 100.
  const meses = agruparPorMes(
    dias(
      ['2026-11-01', 0, 0, 10000],
      ['2026-11-02', 0, 0, 10000],
      ['2026-11-30', 0, 0, 10000],
    ),
  );
  assert.equal(meses.length, 1);
  assert.equal(meses[0].saldo, 10000);
});

test('entra e sai SOMAM dentro do mês — são fluxo, não acumulado', () => {
  const meses = agruparPorMes(
    dias(
      ['2026-11-05', 400000, 0, 400000],
      ['2026-11-10', 0, 150000, 250000],
      ['2026-11-30', 0, 50000, 200000],
    ),
  );
  assert.equal(meses[0].entra, 400000);
  assert.equal(meses[0].sai, 200000);
  assert.equal(meses[0].saldo, 200000);
});

test('vários meses saem em ordem, cada um com o próprio acumulado', () => {
  const meses = agruparPorMes(
    dias(
      ['2026-11-30', 0, 0, 20000],
      ['2026-12-31', 0, 0, -5000],
      ['2027-01-31', 0, 0, 30000],
    ),
  );
  assert.deepEqual(
    meses.map((m) => [m.mes, m.saldo]),
    [
      ['2026-11', 20000],
      ['2026-12', -5000],
      ['2027-01', 30000],
    ],
  );
});

test('marca o primeiro dia do mês em que o acumulado vira negativo', () => {
  const meses = agruparPorMes(
    dias(
      ['2026-12-01', 0, 0, 5000],
      ['2026-12-10', 0, 8000, -3000],
      ['2026-12-20', 0, 1000, -4000],
    ),
  );
  // o PRIMEIRO, não o pior: é a data em que ele precisa agir
  assert.equal(meses[0].primeiroNegativo, '2026-12-10');
});

test('mês sem nenhum dia negativo não inventa data', () => {
  const meses = agruparPorMes(dias(['2026-11-30', 0, 0, 100]));
  assert.equal(meses[0].primeiroNegativo, null);
});

/**
 * O primeiro e o último mês quase sempre estão cortados: a série começa HOJE e termina no
 * horizonte. Rotular "novembro" um pedaço de novembro é o tipo de mentira que só aparece
 * quando o número não bate com a planilha.
 */
test('marca como parcial o mês que começa depois do dia 1', () => {
  const meses = agruparPorMes(dias(['2026-11-10', 0, 0, 100], ['2026-11-30', 0, 0, 100]));
  assert.equal(meses[0].parcial, true);
});

test('marca como parcial o mês cortado pelo horizonte', () => {
  const meses = agruparPorMes(
    dias(['2026-11-01', 0, 0, 100], ['2026-11-30', 0, 0, 100], ['2026-12-15', 0, 0, 100]),
  );
  assert.equal(meses[0].parcial, false);
  assert.equal(meses[1].parcial, true);
});

test('mês que termina no último dia NÃO é parcial — inclusive fevereiro', () => {
  const meses = agruparPorMes(dias(['2027-02-01', 0, 0, 100], ['2027-02-28', 0, 0, 100]));
  assert.equal(meses[0].parcial, false);
});

test('série vazia não quebra', () => {
  assert.deepEqual(agruparPorMes([]), []);
});

test('o corte é o mês da cobertura, e só quando há mês além dele', () => {
  const meses = agruparPorMes(
    dias(['2026-11-30', 0, 0, 1], ['2026-12-31', 0, 0, 1], ['2027-01-31', 0, 0, 1]),
  );
  assert.equal(mesDoCorte(meses, '2026-12-09'), '2026-12');
  // tudo dentro da cobertura: não há o que avisar
  assert.equal(mesDoCorte(meses, '2027-06-01'), null);
  assert.equal(mesDoCorte(meses, null), null);
});
