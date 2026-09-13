/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rotaDaLinha } from './cycle-routes.ts';

test('a parcela do cronograma abre A DÍVIDA CERTA, com o id', () => {
  // `ref_id` de uma linha de cronograma é id de DÍVIDA, não de lançamento — empurrar
  // `/finance/[txId]` com ele abriria uma tela que não existe. É a mesma lição de `kind='debt'`
  // em upcoming_bills, e ela sobreviveu à tela do mês, que foi apagada.
  //
  // E vai com o `id`: mandar para a LISTA fazia quem tem cinco financiamentos caçar qual era.
  assert.deepEqual(rotaDaLinha('debt_schedule', 'debt-1'), {
    pathname: '/finance/debts',
    params: { id: 'debt-1' },
  });
});

test('fatura abre a FATURA; o pagamento dela abre o LANÇAMENTO', () => {
  // O pagamento é o `transfer` para o cartão — mandar o id dele para a tela da fatura abriria
  // uma tela vazia.
  assert.equal(rotaDaLinha('invoice', 'inv-1')?.pathname, '/finance/invoice/[id]');
  assert.equal(rotaDaLinha('invoice_payment', 'tx-1')?.pathname, '/finance/[txId]');
  assert.equal(rotaDaLinha('transaction', 'tx-2')?.pathname, '/finance/[txId]');
});

test('o que é projetado da regra não tem destino', () => {
  // Não existe lançamento para abrir: a recorrente distante é expandida da regra, não criada.
  assert.equal(rotaDaLinha('recurring_projection', 'rec-1'), null);
});
