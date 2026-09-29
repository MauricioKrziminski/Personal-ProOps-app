import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fechamentoComHipoteses, linhasDasHipoteses } from './rascunho-no-ciclo.ts';

const hipoteses = [
  { kind: 'income' as const, amount_cents: 67500, start: '2026-09-28', installments: 1 },
  { kind: 'expense' as const, amount_cents: 300000, start: '2026-09-28', installments: 3 },
  { kind: 'expense' as const, amount_cents: 10000, start: '2026-10-05', installments: 1, mode: 'cancel' as const, rotulo: 'adianta 1 parcela de Mac' },
  { kind: 'expense' as const, amount_cents: 90000, start: '2026-10-01', installments: 1, rotulo: 'adianta 1 parcela de Mac' },
];

test('cada ocorrência vira uma linha com nome, e a parcela adiantada lê como dinheiro que fica', () => {
  const linhas = linhasDasHipoteses(
    [
      { i: 0, day: '2026-09-28', kind: 'income', cents: 67500 },
      { i: 1, day: '2026-10-28', kind: 'expense', cents: 100000 },
      { i: 2, day: '2026-10-05', kind: 'expense', cents: -10000 },
      { i: 3, day: '2026-10-01', kind: 'expense', cents: 90000 },
    ],
    hipoteses,
  );
  assert.deepEqual(linhas.map((l) => [l.title, l.in_cents, l.out_cents]), [
    ['Entrada da hipótese', 67500, 0],
    ['Gasto da hipótese', 0, 100000],
    ['Parcela adiantada', 10000, 0],
    ['Adianta 1 parcela de Mac', 0, 90000],
  ]);
  assert.equal(linhas[2].method_label, 'hipótese · adianta 1 parcela de Mac');
  assert.ok(linhas.every((l) => l.origin === 'hipotese'));
});

test('o fechamento soma o efeito de antes no "comecei" e o de dentro em entrou/saiu', () => {
  const ciclo = { comecei_com: 100000, entrou: 500000, saiu: 400000, resultado: 200000, caixa_no_fim: 200000, estado: 'aberto' };
  const f = fechamentoComHipoteses(ciclo, -22500, [
    { i: 1, day: '2026-10-28', kind: 'expense', cents: 100000 },
    { i: 2, day: '2026-10-05', kind: 'expense', cents: -10000 },
  ]);
  assert.equal(f.comecei_com, 77500);
  assert.equal(f.entrou, 500000);
  assert.equal(f.saiu, 490000, 'a parcela adiantada diminui o que sai');
  // comecei + entrou − saiu continua fechando
  assert.equal(f.resultado, f.comecei_com + f.entrou - f.saiu);
  assert.equal(f.caixa_no_fim, 200000 - 22500 - 90000);
  assert.equal(f.estado, 'aberto');
});
