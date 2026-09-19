import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diasAte, estadoDaFatura, ordemDaPilha, outrasFaturas, prazoLabel } from './card-status.ts';

const hoje = new Date(2026, 8, 16, 22, 30);

test('prazo lê a data pura, sem a hora de agora', () => {
  assert.equal(diasAte('2026-09-16', hoje), 0);
  assert.equal(prazoLabel('2026-09-17', 'vence', hoje), 'vence amanhã');
  assert.equal(prazoLabel('2026-09-20', 'fecha', hoje), 'fecha em 4 dias');
  assert.equal(prazoLabel('2026-09-10', 'vence', hoje), 'venceu há 6 dias');
});

test('estado sai das datas: atrasada vence antes de fechada', () => {
  const base = { invoice_id: 'i', closing_date: '2026-09-03', due_date: '2026-09-10' };
  assert.equal(estadoDaFatura(base, hoje), 'Atrasada');
  assert.equal(estadoDaFatura({ ...base, due_date: '2026-09-20' }, hoje), 'Fechada');
  assert.equal(estadoDaFatura({ ...base, closing_date: '2026-10-03', due_date: '2026-10-10' }, hoje), 'Aberta');
  assert.equal(estadoDaFatura({ ...base, invoice_id: null }, hoje), null);
});

test('outras faturas: o que o limite usa fora da corrente e das atrasadas', () => {
  const linha = (unpaid: number, aberto: number, overdue: number) => ({
    unpaid_total_cents: unpaid,
    invoice_open_cents: aberto,
    invoice_total_cents: aberto,
    overdue_total_cents: overdue,
  });
  // Corrente em dia: sai ela e sai a faixa de atraso.
  assert.equal(outrasFaturas(linha(300_000, 100_000, 50_000), 'Aberta'), 150_000);
  // Corrente vencida já está nas atrasadas — descontar duas vezes zerava isto.
  assert.equal(outrasFaturas(linha(192_500, 128_000, 128_000), 'Atrasada'), 64_500);
  assert.equal(outrasFaturas(linha(2_046_000, 243_000, 513_000), 'Atrasada'), 1_533_000);
  assert.equal(outrasFaturas(linha(100_000, 100_000, 0), 'Fechada'), 0);
  // Pagamento parcial na corrente: 300 de compras com 120 pagos deixam 180 em aberto, e o que
  // sobra em outras faturas são os 90 — com o BRUTO a linha dizia 0.
  assert.equal(
    outrasFaturas({ ...linha(270_000, 180_000, 0), invoice_total_cents: 300_000 }, 'Fechada'),
    90_000
  );
  // RPC antiga (produção sem a `20260917120000`): sem a coluna vale o total, nunca o zero — com
  // zero, a própria fatura corrente entrava em "outras faturas".
  assert.equal(
    outrasFaturas({ unpaid_total_cents: 400_000, invoice_total_cents: 100_000, overdue_total_cents: 0 }, 'Aberta'),
    300_000
  );
  assert.equal(
    outrasFaturas({ unpaid_total_cents: null, invoice_open_cents: null, invoice_total_cents: null, overdue_total_cents: null }, null),
    0
  );
});

test('pilha: o escolhido vai para a frente e o resto fica na ordem original', () => {
  const cards = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((account_id) => ({ account_id }));
  const ids = (escolhido: string | null | undefined, max = 6) =>
    ordemDaPilha(cards, escolhido, max).map((c) => c.account_id).join('');
  assert.equal(ids('a'), 'abcdef', 'o primeiro já é a frente');
  assert.equal(ids('c'), 'cabdef', 'do meio: sai do lugar e os outros não se mexem');
  assert.equal(ids('g'), 'gabcde', 'além do corte ele ENTRA, senão a pilha fica sem frente');
  assert.equal(ids('h', 3), 'hab');
  assert.equal(ids('zz'), 'abcdef', 'id desconhecido cai no primeiro');
  assert.equal(ids(null), 'abcdef');
  assert.equal(ids(undefined), 'abcdef');
  assert.deepEqual(ordemDaPilha([], 'a', 6), []);
});
