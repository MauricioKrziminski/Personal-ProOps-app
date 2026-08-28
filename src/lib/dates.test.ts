/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  brToISO,
  formatBRL,
  formatDateBR,
  isValidBRDate,
  isValidTime,
  isoToBR,
  localDateTime,
  localISODate,
  monthBounds,
  timeBR,
} from './dates.ts';

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

test('formatDateBR devolve dd/mm/yyyy — a MESMA grafia de `isoToBR`', () => {
  assert.equal(formatDateBR(new Date(2026, 7, 5)), '05/08/2026');
});

test('formatBRL trabalha em centavos inteiros', () => {
  assert.match(formatBRL(4500), /45,00/);
  assert.match(formatBRL(123456), /1\.234,56/);
  assert.match(formatBRL(0), /0,00/);
});

test('conversão entre ISO e dd/mm/aaaa', () => {
  assert.equal(isoToBR('2026-08-26'), '26/08/2026');
  assert.equal(brToISO('26/08/2026'), '2026-08-26');
  assert.equal(brToISO(isoToBR('2026-01-05')), '2026-01-05');
});

test('validação de data recusa dia que não existe', () => {
  assert.equal(isValidBRDate('26/08/2026'), true);
  assert.equal(isValidBRDate('29/02/2028'), true);  // bissexto
  assert.equal(isValidBRDate('29/02/2026'), false); // não bissexto
  assert.equal(isValidBRDate('31/04/2026'), false);
  assert.equal(isValidBRDate('26/8/2026'), false);
  assert.equal(isValidBRDate(''), false);
});

test('validação de hora em 24h', () => {
  assert.equal(isValidTime('09:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('09:60'), false);
  assert.equal(isValidTime('9:00'), false);
});

test('localDateTime monta o instante no fuso do aparelho', () => {
  const d = localDateTime('26/08/2026', '21:43');
  assert.ok(d);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 26);
  assert.equal(d.getHours(), 21);
  assert.equal(d.getMinutes(), 43);
  assert.equal(timeBR(d), '21:43');
  assert.equal(localDateTime('31/02/2026', '09:00'), null);
  assert.equal(localDateTime('26/08/2026', '25:00'), null);
});

test('data pura não anda um dia para trás em fuso negativo', () => {
  // `new Date('2026-08-28')` é meia-noite UTC; em -03 o getDate() disso é 27.
  assert.equal(formatDateBR('2026-08-28'), '28/08/2026');
  assert.equal(formatDateBR('2026-01-01'), '01/01/2026');
  assert.equal(formatDateBR('2026-12-31'), '31/12/2026');
});

test('timestamptz continua sendo lido no fuso local', () => {
  assert.equal(formatDateBR(new Date(2026, 7, 28, 23, 30)), '28/08/2026');
});

test('data: `formatDateBR` e `isoToBR` escrevem a MESMA data igual', () => {
  // As duas convivem (uma lê Date/ISO, a outra converte para input de texto) e já divergiram:
  // leitura em `28-08-2026`, formulário em `28/08/2026`.
  assert.equal(formatDateBR('2026-08-28'), isoToBR('2026-08-28'));
  assert.equal(formatDateBR('2026-01-09'), isoToBR('2026-01-09'));
});
