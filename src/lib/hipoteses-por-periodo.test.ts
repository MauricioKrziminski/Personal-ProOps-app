import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agruparPorPeriodo, periodoDe } from './hipoteses-por-periodo.ts';
import type { MesProjetado } from './forecast-months.ts';

// Ciclo que fecha no dia 10: "Outubro" é 11/09–10/10, "Novembro" 11/10–10/11, "Dezembro" 11/11–10/12.
const mes = (m: string, de: string, ate: string, saldo: number): MesProjetado =>
  ({ mes: m, de, ate, saldo, entra: 0, sai: 0, primeiroNegativo: null, parcial: false });
const ciclos = [
  mes('2026-10', '2026-09-11', '2026-10-10', 1000),
  mes('2026-11', '2026-10-11', '2026-11-10', -300),
  mes('2026-12', '2026-11-11', '2026-12-10', 500),
];

test('periodoDe: a data cai no ciclo pelas bordas reais, não pelo mês civil', () => {
  assert.equal(periodoDe(ciclos, '2026-10-10')?.mes, '2026-10');
  assert.equal(periodoDe(ciclos, '2026-10-11')?.mes, '2026-11');
  assert.equal(periodoDe(ciclos, '2026-11-25')?.mes, '2026-12');
  assert.equal(periodoDe(ciclos, '2027-03-01'), null, 'fora do horizonte: nada inventado');
  assert.equal(periodoDe([], '2026-10-01'), null);
});

test('agruparPorPeriodo: grupos em ordem de período, itens em ordem de data', () => {
  const itens = [
    { data: '2026-11-25', item: 'c' },
    { data: '2026-10-20', item: 'b' },
    { data: '2026-10-05', item: 'a' },
    { data: '2026-10-20', item: 'b2' },
  ];
  const g = agruparPorPeriodo(itens, ciclos);
  assert.deepEqual(g.map((x) => x.mes), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(g.map((x) => x.itens), [['a'], ['b', 'b2'], ['c']], 'empate de data mantém a ordem de criação');
  assert.equal(g[1].periodo?.saldo, -300);
});

test('agruparPorPeriodo: data fora do horizonte agrupa pelo mês civil, sem saldo', () => {
  const g = agruparPorPeriodo([{ data: '2027-03-15', item: 'x' }, { data: '2026-10-01', item: 'y' }], ciclos);
  assert.deepEqual(g.map((x) => [x.mes, x.periodo === null]), [['2026-10', false], ['2027-03', true]]);
});
