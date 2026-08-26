/**
 * Testes dos helpers de fuso das Edge Functions (rodam no runtime UTC).
 * `node --test` (Node 24 faz type stripping nativo).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fromNaive,
  localDateTimeISO,
  localISODate,
  offsetMinutes,
  offsetSuffix,
  toInstantISO,
  toNaive,
} from './datetime.ts';

const SP = 'America/Sao_Paulo';

test('localISODate usa o dia do usuário, não o dia UTC', () => {
  // 22h30 de 26/08 em São Paulo já é 01h30 de 27/08 em UTC — o bug antigo
  // carimbava o gasto no dia seguinte.
  assert.equal(localISODate(new Date('2026-08-27T01:30:00Z'), SP), '2026-08-26');
  assert.equal(localISODate(new Date('2026-08-26T23:30:00Z'), SP), '2026-08-26');
  assert.equal(localISODate(new Date('2026-08-27T03:30:00Z'), SP), '2026-08-27');
});

test('localISODate cai para UTC se o timezone do profile for inválido', () => {
  assert.equal(localISODate(new Date('2026-08-27T01:30:00Z'), 'Nao/Existe'), '2026-08-27');
});

test('localDateTimeISO manda a hora de parede do usuário para o prompt', () => {
  // 21h43 de 13/07 em São Paulo — o prompt antes recebia "2026-07-14T00:43Z" e o
  // modelo tinha que descontar o fuso sozinho para saber que "hoje" era dia 13.
  assert.equal(
    localDateTimeISO(new Date('2026-07-14T00:43:57Z'), SP),
    '2026-07-13T21:43:57-03:00',
  );
  assert.equal(
    localDateTimeISO(new Date('2026-07-14T00:43:57Z'), 'UTC'),
    '2026-07-14T00:43:57+00:00',
  );
});

test('offset do fuso', () => {
  assert.equal(offsetMinutes(new Date('2026-08-26T12:00:00Z'), SP), -180);
  assert.equal(offsetSuffix(new Date('2026-08-26T12:00:00Z'), SP), '-03:00');
  assert.equal(offsetMinutes(new Date('2026-08-26T12:00:00Z'), 'UTC'), 0);
  assert.equal(offsetSuffix(new Date('2026-08-26T12:00:00Z'), 'Asia/Kolkata'), '+05:30');
});

test('toInstantISO trata hora sem offset como hora local do usuário', () => {
  // "me lembra amanhã às 9h" -> 9h em São Paulo == 12h UTC (antes virava 9h UTC = 6h BRT)
  assert.equal(toInstantISO('2026-08-27T09:00:00', SP, new Date()), '2026-08-27T12:00:00.000Z');
});

test('toInstantISO respeita offset explícito do modelo', () => {
  assert.equal(toInstantISO('2026-08-27T09:00:00-03:00', SP, new Date()), '2026-08-27T12:00:00.000Z');
  assert.equal(toInstantISO('2026-08-27T12:00:00Z', SP, new Date()), '2026-08-27T12:00:00.000Z');
});

test('toInstantISO aceita data pura e cai no fallback quando não dá para ler', () => {
  assert.equal(toInstantISO('2026-08-27', SP, new Date()), '2026-08-27T03:00:00.000Z');

  const fallback = new Date('2026-01-01T00:00:00Z');
  assert.equal(toInstantISO(null, SP, fallback), fallback.toISOString());
  assert.equal(toInstantISO('   ', SP, fallback), fallback.toISOString());
  assert.equal(toInstantISO('amanhã de manhã', SP, fallback), fallback.toISOString());
});

test('toNaive/fromNaive fazem ida e volta', () => {
  const instant = new Date('2026-08-27T12:00:00Z');
  const naive = toNaive(instant, SP);
  // hora de parede do usuário lida como se fosse UTC
  assert.equal(naive.toISOString(), '2026-08-27T09:00:00.000Z');
  assert.equal(fromNaive(naive, SP).toISOString(), instant.toISOString());
});
