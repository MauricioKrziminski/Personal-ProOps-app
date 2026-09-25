import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dataDaCompra, filtroDoEstado, rotuloDaCompra } from './data-da-compra.ts';
import { estadoDaLinha } from './settle-labels.ts';

const parcela = (n: number, occurred_at: string, first: string) => ({
  occurred_at,
  installment_no: n,
  installment_plans: { first_occurred_at: first },
});

test('A data da compra de uma parcela é a da parcela 1, não a do mês em que ela cai', () => {
  // "o wardogs mostra na data que vai entrar na fatura ao invés de mostrar a data que o lançamento
  // foi feito de fato" (24/09/2026): a 2/2 mora em 14/10, a compra foi em 14/09.
  assert.equal(dataDaCompra(parcela(2, '2026-10-14', '2026-09-14')), '2026-09-14');
  assert.equal(rotuloDaCompra(parcela(2, '2026-10-14', '2026-09-14')), 'compra em 14/09');
  // A parcela 1 já está na data da compra: nada a acrescentar.
  assert.equal(rotuloDaCompra(parcela(1, '2026-09-14', '2026-09-14')), null);
  // Avulso: a data é a dele.
  assert.equal(rotuloDaCompra({ occurred_at: '2026-09-21', installment_no: null, installment_plans: null }), null);
  assert.equal(dataDaCompra({ occurred_at: '2026-09-21', installment_no: null }), '2026-09-21');
});

test('Compra de outro ano leva o ano junto', () => {
  assert.equal(rotuloDaCompra(parcela(14, '2026-10-05', '2025-09-05')), 'compra em 05/09/2025');
});

test('"Concluído" é o que já aconteceu — a mesma régua da pílula', () => {
  const hoje = '2026-09-24';
  assert.deepEqual(filtroDoEstado('cleared', hoje), {
    ou: 'status.eq.cleared,and(invoice_id.not.is.null,occurred_at.lte.2026-09-24)',
  });
  assert.deepEqual(filtroDoEstado('pending', hoje), {
    status: 'pending',
    ou: 'invoice_id.is.null,occurred_at.gt.2026-09-24',
  });
  // Espelho das duas expressões sobre as mesmas linhas que `estadoDaLinha` decide: toda linha cai
  // em exatamente um dos dois filtros, e "Concluído" é exatamente a que não tem pílula.
  const linhas = [
    { kind: 'expense', status: 'pending', occurred_at: '2026-09-14', due_at: '2026-10-10', invoice_id: 'f1' }, // wardogs 1/2
    { kind: 'expense', status: 'pending', occurred_at: '2026-10-14', due_at: '2026-11-10', invoice_id: 'f2' }, // wardogs 2/2
    { kind: 'expense', status: 'pending', occurred_at: '2026-09-24', due_at: '2026-10-10', invoice_id: 'f1' }, // hoje no cartão
    { kind: 'expense', status: 'cleared', occurred_at: '2026-09-02', due_at: null, invoice_id: null },
    { kind: 'expense', status: 'pending', occurred_at: '2026-09-05', due_at: '2026-09-05', invoice_id: null }, // boleto atrasado
    { kind: 'income', status: 'pending', occurred_at: '2026-10-05', due_at: null, invoice_id: null },
  ];
  const concluido = (t: (typeof linhas)[number]) => t.status === 'cleared' || (t.invoice_id !== null && t.occurred_at <= hoje);
  const emAberto = (t: (typeof linhas)[number]) => t.status === 'pending' && (t.invoice_id === null || t.occurred_at > hoje);
  for (const t of linhas) {
    assert.notEqual(concluido(t), emAberto(t), JSON.stringify(t));
    assert.equal(concluido(t), estadoDaLinha(t, hoje) === null, JSON.stringify(t));
  }
});
