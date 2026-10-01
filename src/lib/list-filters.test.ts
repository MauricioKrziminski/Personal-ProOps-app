import assert from 'node:assert/strict';
import test from 'node:test';
import * as filters from './list-filters.ts';

test('resumo descreve datas e valores como intervalos e resolve seleções pelos mesmos rótulos da folha', () => {
  const value = { q: '  aluguel  ', from: '2026-09-01', to: '2026-09-30', minCents: 0, maxCents: 20000,
    selections: { account: 'a', status: 'paused', empty: '' } };
  const details = filters.listFilterDetails(value, { dateLabel: 'Atualização', formatAmount: n => `R$ ${n / 100}`,
    selects: [
      { key: 'account', label: 'Conta', options: [{ id: 'a', label: 'Minha conta de nome completo' }] },
      { key: 'status', label: 'Estado', options: [{ id: 'paused', label: 'Pausados' }] },
    ] });
  assert.deepEqual(details, ['Atualização: 01/09/2026 a 30/09/2026', 'Busca: aluguel',
    'Conta: Minha conta de nome completo', 'Estado: Pausados', 'Valor: R$ 0 a R$ 200']);
  assert.equal(details.length, filters.listFilterCount(value));
  assert.deepEqual(filters.listFilterDetails({ ...value, selections: { status: 'paused', account: 'a' } }, {
    dateLabel: 'Atualização', formatAmount: n => `R$ ${n / 100}`,
    selects: [
      { key: 'account', label: 'Conta', options: [{ id: 'a', label: 'Minha conta de nome completo' }] },
      { key: 'status', label: 'Estado', options: [{ id: 'paused', label: 'Pausados' }] },
    ],
  }), details, 'ordem do resumo é a da folha, independente da ordem dos toques');
});

test('resumo cobre bordas únicas, mesmo dia, zero, privacidade e opção que deixou de estar disponível', () => {
  const options = { formatAmount: () => '••••••', selects: [{ key: 'account', label: 'Conta', options: [] }] };
  assert.deepEqual(filters.listFilterDetails({ from: '2026-09-30' }, options), ['Data: a partir de 30/09/2026']);
  assert.deepEqual(filters.listFilterDetails({ to: '2026-09-30' }, options), ['Data: até 30/09/2026']);
  assert.deepEqual(filters.listFilterDetails({ from: '2026-09-30', to: '2026-09-30' }, options), ['Data: 30/09/2026']);
  assert.deepEqual(filters.listFilterDetails({ q: '  ', minCents: 0 }, options), ['Valor: a partir de ••••••']);
  assert.deepEqual(filters.listFilterDetails({ maxCents: 0 }, options), ['Valor: até ••••••']);
  const hidden = filters.listFilterDetails({ selections: { account: 'private-uuid', missing: 'raw-id' } }, options);
  assert.deepEqual(hidden, ['Conta: seleção indisponível', 'Critério selecionado']);
  assert.doesNotMatch(hidden.join(), /private-uuid|raw-id/);
  assert.deepEqual(filters.listFilterDetails({}, options), []);
});

test('contagem agrupa período e faixa de valor, reconhece zero e ignora critérios vazios', () => {
  assert.equal(filters.listFilterCount({}), 0);
  assert.equal(filters.listFilterCount({ q: '  ', selections: { kind: '', accountId: '' } }), 0);
  assert.equal(filters.listFilterCount({ from: '2026-09-01', to: '2026-09-30', minCents: 0, maxCents: 20000 }), 2);
  assert.equal(filters.listFilterCount({ q: 'café', selections: { kind: 'expense', status: 'cleared', category: '', accountId: 'none' } }), 4);
  assert.equal(filters.listFilterCount({ from: '2026-09-01', maxCents: 0 }), 2);
});

test('período inclusivo aceita mesmo dia e rejeita datas invertidas ou inexistentes', () => {
  assert.equal(filters.listFilterError({ from: '2026-09-30', to: '2026-09-30' }), undefined);
  assert.equal(filters.listFilterError({ from: '2026-10-01', to: '2026-09-30' }), 'A data final deve ser igual ou posterior à inicial');
  assert.equal(filters.listFilterError({ from: '2026-02-30' }), 'Escolha uma data válida');
  assert.equal(filters.listFilterError({ to: '2026-09-30' }), undefined);
  assert.equal(filters.listFilterError({ from: '2026-09-30' }), undefined);
});

test('limites de dinheiro são centavos inteiros, inclusivos, e zero é um filtro', () => {
  assert.equal(filters.listFilterError({ minCents: 0, maxCents: 0 }), undefined);
  assert.equal(filters.listFilterError({ minCents: 20000, maxCents: 19999 }), 'O valor máximo deve ser igual ou maior que o mínimo');
  assert.equal(filters.listFilterError({ minCents: -1 }), 'Informe valores válidos');
  assert.equal(filters.listFilterError({ minCents: 1.5 }), 'Informe valores válidos');
  assert.equal(filters.listFiltersActive({ minCents: 0 }), true);
  assert.equal(filters.listFiltersActive({ q: '  ', selections: { state: '' } }), false);
});

test('divide previsões extensas sem perder bordas, inclusive virada de ano e fevereiro bissexto', () => {
  const windows = filters.dateWindows('2026-12-31', '2027-05-31', 62);
  assert.equal(windows[0].from, '2026-12-31');
  assert.equal(windows.at(-1)?.to, '2027-05-31');
  const days = windows.flatMap(w => filters.dateWindows(w.from, w.to, 1).map(d => d.from));
  assert.equal(days.length, 152); assert.equal(new Set(days).size, days.length);
  assert.deepEqual(filters.dateWindows('2028-02-28', '2028-03-01', 2), [
    { from: '2028-02-28', to: '2028-02-29' }, { from: '2028-03-01', to: '2028-03-01' },
  ]);
  assert.throws(() => filters.dateWindows('2026-10-01', '2026-09-30'));
  assert.throws(() => filters.dateWindows('2026-09-30', '2026-10-01', 0));
});

test('timestamps usam o dia BRT inteiro, final exclusivo na virada do ano', () => {
  const previous = process.env.TZ; process.env.TZ = 'America/Sao_Paulo';
  try {
  assert.deepEqual(filters.timestampDateBounds({ from: '2026-12-31', to: '2026-12-31' }), {
    from: '2026-12-31T03:00:00.000Z', before: '2027-01-01T03:00:00.000Z',
  });
  assert.deepEqual(filters.timestampDateBounds({ to: '2028-02-29' }), { from: undefined, before: '2028-03-01T03:00:00.000Z' });
  process.env.TZ = 'America/New_York';
  assert.deepEqual(filters.timestampDateBounds({ from: '2026-03-08', to: '2026-03-08' }), {
    from: '2026-03-08T05:00:00.000Z', before: '2026-03-09T04:00:00.000Z',
  });
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
