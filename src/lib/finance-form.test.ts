import assert from 'node:assert/strict';
import test from 'node:test';
import {
  debtTerm, validRecurringRange, simpleDebtValues, destinoDoSalvar, podeParcelar, temContrato, faixaDeParcelas,
  totalDigitado, totalPorParcela, parcelaDoTotal, valorExibido, digitarValor, nomeDaCompra, type Contrato,
} from './finance-form.ts';
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
const saldoAdiado = {
  id: 'tx-1',
  installment_plan_id: null,
  recurring_id: null,
  debt_id: null,
  rollover_of_invoice_id: 'fatura-1',
};

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

/**
 * ⚠️ **Achado da revisão final (20/09/2026).** O saldo adiado de fatura ("Saldo em rotativo de
 * Julho") é `expense`, tem cartão e não tinha nenhum dos três contratos originais — o chip "2x"
 * aparecia e a RPC recusava (`rollover_of_invoice_id is not null`, a coluna não é herdada pelas
 * parcelas).
 */
test('saldo adiado de fatura não se parcela por aqui', () => {
  assert.equal(podeParcelar('expense', 'card-1', saldoAdiado), false);
  assert.equal(temContrato(saldoAdiado), true);
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

/** ⚠️ Sem o `1` não havia como desfazer um parcelamento; e a lista fixa não deixava 5x, 7x, 8x. */
test('o número de parcelas é faixa aberta de 1 a 72 quando nada foi pago', () => {
  assert.deepEqual(faixaDeParcelas(0), { min: 1, max: 72 });
});

/** Com parcela travada o banco recusa "à vista" (`1 <> N`): o mínimo sobe para 2. */
test('com parcela paga, "À vista" sai da faixa', () => {
  assert.deepEqual(faixaDeParcelas(1), { min: 2, max: 72 });
  assert.equal(faixaDeParcelas(3).min, 2);
});

// ── o valor de uma compra parcelada: total ou cada parcela (23/09/2026) ─────────────

test('criando em N×, "parcela" multiplica e "total" fica como digitado', () => {
  assert.equal(totalDigitado(25000, 'parcela', 12), 300000);
  assert.equal(totalDigitado(300000, 'total', 12), 300000);
  // à vista, parcela e total são a mesma coisa
  assert.equal(totalDigitado(25000, 'parcela', 1), 25000);
});

const tv: Contrato = { parcelas: 10, travadas: 1, travadoCents: 30000 };

test('numa compra que já existe, "cada parcela" vale para as em aberto e a travada fica', () => {
  // tv 10× de 300 com a 1ª paga: cada uma das 9 abertas a 250 → 300 + 9×250
  assert.equal(totalPorParcela(25000, tv), 30000 + 9 * 25000);
  assert.equal(parcelaDoTotal(300000, tv), 30000);
});

test('trocar a unidade sem digitar não muda a compra — nem por um centavo', () => {
  const c: Contrato = { parcelas: 3, travadas: 0, travadoCents: 0 };
  const v = { totalCents: 1000, parcelaCents: null };
  // a divisão cairia em 333 (volta 999); a parcela exibida é a de hoje e o total não se mexe
  assert.equal(valorExibido(v, 'parcela', c, 334, 1000), 334);
  assert.equal(valorExibido(v, 'total', c, 334, 1000), 1000);
  assert.equal(v.totalCents, 1000);
});

test('digitar em "parcela" guarda o que foi digitado e recalcula o total', () => {
  const v = digitarValor(25000, 'parcela', tv);
  assert.deepEqual(v, { totalCents: 255000, parcelaCents: 25000 });
  assert.equal(valorExibido(v, 'parcela', tv, 30000, 300000), 25000);
  assert.equal(valorExibido(v, 'total', tv, 30000, 300000), 255000);
  // digitar em "total" esquece a parcela digitada
  assert.deepEqual(digitarValor(350000, 'total', tv), { totalCents: 350000, parcelaCents: null });
});

test('com tudo pago, "cada parcela" não alcança nenhuma', () => {
  const quitada: Contrato = { parcelas: 2, travadas: 2, travadoCents: 20000 };
  assert.equal(totalPorParcela(99999, quitada), 20000);
  assert.equal(parcelaDoTotal(20000, quitada), 0);
});

test('o nome da compra é o da parcela sem o "(k/N)"', () => {
  assert.equal(nomeDaCompra('tv (2/10)'), 'tv');
  assert.equal(nomeDaCompra('Controle (mãe) (1/4)'), 'Controle (mãe)');
  assert.equal(nomeDaCompra('Sem sufixo'), 'Sem sufixo');
});

test('mudar o valor de uma parcela edita a COMPRA; o resto continua no update da linha', () => {
  const parcela = { id: 'tx', installment_plan_id: 'p' };
  assert.equal(destinoDoSalvar(parcela, { installments: 1, account_id: 'c', valorDaCompraMudou: true }), 'editarCompra');
  assert.equal(destinoDoSalvar(parcela, { installments: 1, account_id: 'c', valorDaCompraMudou: false }), 'salvar');
  // lançamento simples não tem compra para editar
  assert.equal(destinoDoSalvar({ id: 'tx' }, { installments: 1, account_id: 'c', valorDaCompraMudou: true }), 'salvar');
});
