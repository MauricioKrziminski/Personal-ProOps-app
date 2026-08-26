/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeRRule } from './rrule-text.ts';

test('frequências simples', () => {
  assert.equal(describeRRule('FREQ=DAILY'), 'todo dia');
  assert.equal(describeRRule('FREQ=WEEKLY'), 'toda semana');
  assert.equal(describeRRule('FREQ=MONTHLY'), 'todo mês');
  assert.equal(describeRRule('FREQ=YEARLY'), 'todo ano');
});

test('dia do mês — a regra que a IA mais gera', () => {
  assert.equal(describeRRule('FREQ=MONTHLY;BYMONTHDAY=5'), 'todo dia 5');
  assert.equal(describeRRule('FREQ=MONTHLY;BYMONTHDAY=1,15'), 'todo dia 1 e 15');
});

test('dias da semana', () => {
  assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=MO'), 'toda segunda');
  assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR'), 'toda segunda, quarta e sexta');
  // concordância de gênero: segunda a sexta são "feira" (feminino), fim de semana é masculino
  assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=SA,SU'), 'todo sábado e domingo');
  assert.equal(describeRRule('FREQ=WEEKLY;BYDAY=SU'), 'todo domingo');
});

test('intervalo maior que 1', () => {
  assert.equal(describeRRule('FREQ=WEEKLY;INTERVAL=2'), 'a cada 2 semanas');
  assert.equal(describeRRule('FREQ=MONTHLY;INTERVAL=3'), 'a cada 3 meses');
  assert.equal(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), 'a cada 2 semanas, segunda');
  assert.equal(describeRRule('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=10'), 'a cada 2 meses, no dia 10');
});

test('aceita o prefixo RRULE: e ordem/caixa variadas', () => {
  assert.equal(describeRRule('RRULE:FREQ=MONTHLY;BYMONTHDAY=5'), 'todo dia 5');
  assert.equal(describeRRule('freq=daily'), 'todo dia');
  assert.equal(describeRRule('  FREQ=WEEKLY;BYDAY=TU  '), 'toda terça');
});

test('o que não dá para interpretar volta cru, sem inventar', () => {
  assert.equal(describeRRule('FREQ=HOURLY'), 'FREQ=HOURLY');
  assert.equal(describeRRule('coisa qualquer'), 'coisa qualquer');
  assert.equal(describeRRule(null), 'sem recorrência');
  assert.equal(describeRRule('   '), 'sem recorrência');
});
