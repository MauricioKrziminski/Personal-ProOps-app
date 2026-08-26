/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatBRL, formatDateBR, localISODate, monthBounds } from './dates.ts';

test('localISODate formata a data local com zero à esquerda', () => {
  assert.equal(localISODate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(localISODate(new Date(2026, 11, 31)), '2026-12-31');
});

test('localISODate não desloca o dia como toISOString faria', () => {
  // 22h em GMT-3 já é o dia seguinte em UTC
  const lateNight = new Date(2026, 7, 26, 22, 30);
  assert.equal(localISODate(lateNight), '2026-08-26');
});

test('monthBounds cobre o mês inteiro, inclusive fevereiro', () => {
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' }); // bissexto
  assert.deepEqual(monthBounds('2026-04'), { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('formatDateBR devolve dd-mm-yyyy', () => {
  assert.equal(formatDateBR(new Date(2026, 7, 5)), '05-08-2026');
});

test('formatBRL trabalha em centavos inteiros', () => {
  assert.match(formatBRL(4500), /45,00/);
  assert.match(formatBRL(123456), /1\.234,56/);
  assert.match(formatBRL(0), /0,00/);
});
