import assert from 'node:assert/strict';
import test from 'node:test';
import { debtTerm, validRecurringRange, simpleDebtValues, destinoDoSalvar, podeParcelar, temContrato, opcoesDeParcelas } from './finance-form.ts';
test('remaining installments are added to already paid, never subtracted twice', () => {
  assert.equal(debtTerm('8', 4), 12);
  assert.equal(debtTerm('', 4), null);
  assert.throws(() => debtTerm('0', 4));
});
test('recurrence end and interval reject invalid schedules', () => {
  assert.equal(validRecurringRange('2026-09-08', '2026-09-07', '1'), false);
  assert.equal(validRecurringRange('2026-09-08', '', '0'), false);
  assert.equal(validRecurringRange('2026-09-08', '2026-09-08', '2'), true);
});

test('debt term rejects fabricated negative or fractional paid history', () => {
  assert.throws(() => debtTerm('40', -1));
  assert.throws(() => debtTerm('40', 8.5));
});

test('retrospective purchase asks paid history and preserves explicit zero', async () => {
  const helpers = await import('./finance-form.ts');
  assert.equal(typeof helpers.installmentHistory, 'function', 'history must have a shared validated boundary');
  const history = helpers.installmentHistory;
  assert.throws(() => history('',48,'2026-01-08','2026-09-08'), /pagas/);
  assert.equal(history('0',48,'2026-01-08','2026-09-08'),0);
  assert.equal(history('8',48,'2026-01-08','2026-09-08'),8);
  assert.equal(history('',48,'2026-09-08','2026-09-08'),0);
  for (const bad of ['-1','8.5','49','8foo']) assert.throws(() => history(bad,48,'2026-01-08','2026-09-08'));
});

test('simple financing needs only installment value and total count, keeping embedded interest unspecified', () => {
  assert.deepEqual(simpleDebtValues(147000, '48', 0), {
    principal_cents: 7056000, remaining_cents: 7056000, installments: 48,
    installments_paid: 0, installment_cents: 147000,
    calculation_mode: 'fixed_installments', interest_rate_monthly: 0,
  });
});
test('simple financing subtracts explicitly paid installments once', () => {
  const values = simpleDebtValues(147000, '48', 8);
  assert.equal(values.remaining_cents, 5880000);
  assert.equal(values.installments, 48);
  assert.equal(values.installments_paid, 8);
});
test('simple financing rejects fractional counts, absent amounts, excess history and unsafe sums', () => {
  for (const [amount, count, paid] of [[0, '48', 0], [147000, '', 0], [147000, '2.5', 0], [147000, '48', 49], [147000, '48', -1], [Number.MAX_SAFE_INTEGER, '48', 0]] as const) {
    assert.throws(() => simpleDebtValues(amount, count, paid));
  }
});

const simples = { id: 'tx-1', installment_plan_id: null, recurring_id: null, debt_id: null };
const parcela = { id: 'tx-1', installment_plan_id: 'plano-1', recurring_id: null, debt_id: null };
const ocorrencia = { id: 'tx-1', installment_plan_id: null, recurring_id: 'serie-1', debt_id: null };
const financiamento = { id: 'tx-1', installment_plan_id: null, recurring_id: null, debt_id: 'divida-1' };

/**
 * ⚠️ A fileira de parcelas era escondida na edição (`!editing`), e o jeito de contornar era
 * LANÇAR DE NOVO — foi assim que a mesma compra apareceu duas vezes na fatura (19/09/2026).
 */
test('parcelar vale também EDITANDO um lançamento simples', () => {
  assert.equal(podeParcelar('expense', 'card-1', undefined), true, 'criando');
  assert.equal(podeParcelar('expense', 'card-1', simples), true, 'editando um simples');
});

test('o que já tem outro contrato não se parcela por aqui', () => {
  // A parcela: quem manda no contrato é a tela da compra. A ocorrência: quem manda é a regra.
  // A parcela de financiamento: quem manda é o cronograma. As três também são recusadas no banco.
  assert.equal(podeParcelar('expense', 'card-1', parcela), false);
  assert.equal(podeParcelar('expense', 'card-1', ocorrencia), false);
  assert.equal(podeParcelar('expense', 'card-1', financiamento), false);
  assert.equal(temContrato(parcela) && temContrato(ocorrencia) && temContrato(financiamento), true);
  assert.equal(temContrato(simples) || temContrato(null), false);
});

test('parcelar continua exigindo gasto e conta', () => {
  assert.equal(podeParcelar('income', 'card-1', simples), false);
  assert.equal(podeParcelar('transfer', 'card-1', simples), false);
  assert.equal(podeParcelar('expense', null, simples), false);
});

/**
 * ⚠️ **UMA escrita, sempre.** O caminho que duplica é justamente "converter E salvar": duas
 * escritas para uma intenção. O destino é exclusivo por construção.
 */
test('criar com 1x salva; criar com 2x cria o plano', () => {
  assert.equal(destinoDoSalvar(null, { installments: 1, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(null, { installments: 2, account_id: 'card-1' }), 'criarPlano');
});

test('editar um simples com 2x CONVERTE — não cria um segundo lançamento', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 2, account_id: 'card-1' }), 'converter');
});

test('editar sem mexer em parcelas continua sendo só o update', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 1, account_id: 'card-1' }), 'salvar');
});

test('editar uma parcela nunca converte, nem com o campo forçado', () => {
  // A fileira nem aparece; isto é o cinto. Converter uma parcela criaria plano dentro de plano.
  assert.equal(destinoDoSalvar(parcela, { installments: 3, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(ocorrencia, { installments: 3, account_id: 'card-1' }), 'salvar');
  assert.equal(destinoDoSalvar(financiamento, { installments: 3, account_id: 'card-1' }), 'salvar');
});

test('sem conta não há para onde parcelar', () => {
  assert.equal(destinoDoSalvar(simples, { installments: 3, account_id: null }), 'salvar');
  assert.equal(destinoDoSalvar(null, { installments: 3, account_id: null }), 'salvar');
});

/**
 * ⚠️ **Sem o `1` não havia como desfazer um parcelamento** — só apagar a compra inteira e lançar
 * de novo, que é a mesma armadilha do formulário. O comentário de `installments.tsx` dizia "as
 * mesmas opções da criação" e a criação SEMPRE teve "À vista".
 */
test('o editor da compra oferece "À vista" quando nada foi pago', () => {
  assert.deepEqual(opcoesDeParcelas(0), [1, 2, 3, 4, 6, 10, 12, 18, 24]);
});

/**
 * ⚠️ Com parcela travada o banco recusa (`1 <> N` cai no guarda que já existia). Botão que só
 * existe para dar erro é defeito — some.
 */
test('com parcela paga, "À vista" nem aparece', () => {
  assert.deepEqual(opcoesDeParcelas(1), [2, 3, 4, 6, 10, 12, 18, 24]);
  assert.equal(opcoesDeParcelas(3).includes(1), false);
});
