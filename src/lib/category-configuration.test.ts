import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryDefaults, categoryBackfillPeriod, categoryConfigurationAttempt,
  type CategoryConfigurationInput,
} from './category-configuration.ts';

test('aparência de outro espaço não prova padrões da configuração padrão', () => {
  assert.deepEqual(categoryDefaults({ default_expense_pattern: 'fixed', default_expense_necessity: 'essential' }), {
    default_expense_pattern: null, default_expense_necessity: null,
  });
  assert.deepEqual(categoryDefaults({ configuration_id: 'config', default_expense_pattern: 'variable', default_expense_necessity: null }), {
    default_expense_pattern: 'variable', default_expense_necessity: null,
  });
});

test('backfill exige duas datas reais em ordem e converte BR para ISO sem fuso', () => {
  for (const [from, to] of [['', '30/09/2026'], ['01/09/2026', ''], ['31/02/2026', '30/09/2026'], ['30/09/2026', '01/09/2026']]) {
    assert.equal(categoryBackfillPeriod(from, to), null);
  }
  assert.deepEqual(categoryBackfillPeriod('01/09/2026', '30/09/2026'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(categoryBackfillPeriod('30/09/2026', '30/09/2026'), { from: '2026-09-30', to: '2026-09-30' });
});

test('retry conserva intenção; padrão, período, revisão e merge renovam a requisição', () => {
  const input: Omit<CategoryConfigurationInput, 'requestId'> = {
    name: 'mercado', icon: 'cart', color: null, configurationId: 'config', expectedRevision: 0,
    renomearDe: 'feira', default_expense_pattern: 'variable', default_expense_necessity: 'essential',
  };
  let n = 0;
  const newId = () => `request-${++n}`;
  const first = categoryConfigurationAttempt(null, input, newId);
  assert.equal(categoryConfigurationAttempt(first, { ...input }, newId), first);
  for (const changed of [
    { ...input, default_expense_pattern: null },
    { ...input, default_expense_necessity: null },
    { ...input, expectedRevision: 1 },
    { ...input, backfill: { from: '2026-09-01', to: '2026-09-30' } },
    { ...input, juntar: true },
  ]) assert.notEqual(categoryConfigurationAttempt(first, changed, newId).requestId, first.requestId);
  // Key order and optional nulls do not turn the same effective command into a new intent.
  assert.equal(categoryConfigurationAttempt(first, { ...input, backfill: null, juntar: false }, newId), first);
});
