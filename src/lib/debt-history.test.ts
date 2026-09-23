/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addMonthsISO, paidInstallments } from './debt-history.ts';

test('a cadência anda para trás sem estourar o fim do mês', () => {
  assert.equal(addMonthsISO('2026-10-08', -1), '2026-09-08');
  assert.equal(addMonthsISO('2026-10-08', -8), '2026-02-08');
  assert.equal(addMonthsISO('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonthsISO('2026-01-31', -1), '2025-12-31');
  assert.equal(addMonthsISO('2026-01-15', 2), '2026-03-15');
});

test('"estou na nona parcela" devolve as oito anteriores, numeradas 1 a 8', () => {
  const linhas = paidInstallments({
    installmentsPaid: 8,
    installmentCents: 147000,
    nextDueDate: '2026-10-08',
  });
  assert.equal(linhas.length, 8);
  assert.deepEqual(
    linhas.map((l) => l.installment_no),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(linhas[0].due_date, '2026-02-08');
  assert.equal(linhas[7].due_date, '2026-09-08');
  assert.ok(linhas.every((l) => l.payment_cents === 147000 && !l.registered));
});

test('pagamento registrado ganha a data e o valor REAIS, não a cadência', () => {
  const linhas = paidInstallments({
    installmentsPaid: 9,
    installmentCents: 147000,
    nextDueDate: '2026-11-08',
    payments: [{ debt_payment_no: 9, occurred_at: '2026-10-03', amount_cents: 150000 }],
  });
  assert.equal(linhas.length, 9);
  assert.deepEqual(linhas[8], {
    installment_no: 9,
    due_date: '2026-10-03',
    payment_cents: 150000,
    registered: true,
  });
  // as oito declaradas continuam na cadência
  assert.equal(linhas[7].due_date, '2026-09-08');
  assert.equal(linhas[7].registered, false);
});

test('nada pago, nada para trás', () => {
  assert.deepEqual(
    paidInstallments({ installmentsPaid: 0, installmentCents: 147000, nextDueDate: '2026-10-08' }),
    [],
  );
});

test('quitada não tem próxima parcela e ainda assim mostra o histórico', () => {
  const linhas = paidInstallments({
    installmentsPaid: 3,
    installmentCents: 50000,
    nextDueDate: null,
  });
  assert.equal(linhas.length, 3);
  assert.deepEqual(
    linhas.map((l) => l.installment_no),
    [1, 2, 3],
  );
});

import { linhaDoTempo } from './debt-history.ts';

test('linha do tempo agrupa por ano e marca paga, estimada, próxima e futura', () => {
  const anos = linhaDoTempo(
    [
      { installment_no: 1, due_date: '2026-11-05', payment_cents: 100, registered: false },
      { installment_no: 2, due_date: '2026-12-05', payment_cents: 100, registered: true },
    ],
    [
      { installment_no: 3, due_date: '2027-01-05', payment_cents: 100, interest_cents: null },
      { installment_no: 4, due_date: '2027-02-05', payment_cents: 100, interest_cents: 7 },
    ],
  );
  assert.deepEqual(anos.map((a) => a.ano), ['2026', '2027']);
  assert.deepEqual(anos[0].itens.map((i) => i.estado), ['estimada', 'paga']);
  assert.deepEqual(anos[1].itens.map((i) => [i.n, i.estado, i.jurosCents]), [[3, 'proxima', null], [4, 'futura', 7]]);
});
