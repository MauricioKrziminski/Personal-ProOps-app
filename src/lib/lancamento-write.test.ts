import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepararLancamento, type LancamentoFormValues, type ContextoDoLancamento } from './lancamento-write.ts';

const values: LancamentoFormValues = { kind: 'expense', amount_cents: 10001, category: 'casa',
  description: '  Mesa  ', merchant: '  Loja  ', account_id: 'conta', payment_method: 'boleto',
  counterparty_account_id: null, installments: 1, fee_cents: 350, auto_confirm: true,
  paid_installments: '0', down_payment_enabled: false, down_payment_cents: 2000,
  down_payment_date: '01/10/2026', down_payment_account: 'entrada', down_payment_method: 'pix',
  value_unit: 'total', occurred_at: '02/10/2026', pending: false, installment_occurrence: false, due_at: null };
const context: ContextoDoLancamento = { podeAdiar: true, podeParcelarAqui: true,
  intencaoDoDia: null, isCard: false, mostraJuros: false, hoje: '2026-10-02' };

// Catches divergence between watched preview values and the submit construction.
test('à vista prepara título, estabelecimento, centavos e uma única gravação', () => {
  const result = prepararLancamento(values, context);
  assert.equal(result.destino, 'salvar');
  assert.deepEqual(result.entradaLancamento, { kind: 'expense', amount_cents: 10001,
    category: 'casa', description: 'Mesa', merchant: 'Loja', account_id: 'conta',
    payment_method: 'boleto', counterparty_account_id: null, occurred_at: '2026-10-02',
    status: 'cleared', due_at: null, fee_cents: 0, auto_confirm: false });
});

test('pendente visível leva vencimento ISO e automático; transferência limpa categoria e guarda destino', () => {
  const pending = prepararLancamento({ ...values, pending: true, due_at: '10/10/2026' }, context);
  assert.equal(pending.entradaLancamento.status, 'pending');
  assert.equal(pending.entradaLancamento.due_at, '2026-10-10');
  assert.equal(pending.entradaLancamento.auto_confirm, true);
  const transfer = prepararLancamento({ ...values, kind: 'transfer', counterparty_account_id: 'destino',
    merchant: '  ', fee_cents: 75 }, { ...context, podeAdiar: false, podeParcelarAqui: false, mostraJuros: true });
  assert.equal(transfer.entradaLancamento.category, null);
  assert.equal(transfer.entradaLancamento.counterparty_account_id, 'destino');
  assert.equal(transfer.entradaLancamento.merchant, null);
  assert.equal(transfer.entradaLancamento.fee_cents, 75);
});

test('campo escondido conserva status, vencimento e automático do registro editado', () => {
  const result = prepararLancamento({ ...values, pending: false, auto_confirm: false }, {
    ...context, podeAdiar: false, editing: { id: 'tx', status: 'pending', due_at: '2026-11-10', auto_confirm: true },
  });
  assert.equal(result.entradaLancamento.status, 'pending');
  assert.equal(result.entradaLancamento.due_at, '2026-11-10');
  assert.equal(result.entradaLancamento.auto_confirm, true);
});

test('valor por parcela e entrada não se misturam no principal nem no histórico', () => {
  const result = prepararLancamento({ ...values, amount_cents: 3334, value_unit: 'parcela',
    installments: 3, down_payment_enabled: true, paid_installments: '1' }, { ...context, podeAdiar: false, intencaoDoDia: 'ultimo' });
  assert.equal(result.destino, 'criarPlano');
  assert.deepEqual(result.entradaParcelada, { accountId: 'conta', paymentMethod: 'boleto', totalCents: 10002,
    installments: 3, paidInstallments: 1, occurredAt: '2026-10-02', description: 'Mesa', category: 'casa',
    merchant: 'Loja', lastDay: true,
    downPayment: { amount_cents: 2000, occurred_at: '2026-10-01', account_id: 'entrada', payment_method: 'pix' } });
});

test('total com entrada subtrai uma vez; último dia não se aplica ao cartão', () => {
  const result = prepararLancamento({ ...values, installments: 3, down_payment_enabled: true },
    { ...context, podeAdiar: false, intencaoDoDia: 'ultimo', isCard: true });
  assert.equal(result.entradaParcelada?.totalCents, 8001);
  assert.equal(result.entradaParcelada?.lastDay, false);
});

test('sem entrada ligada centavo restante e histórico são preservados; lançamento existente converte', () => {
  const result = prepararLancamento({ ...values, installments: 3, occurred_at: '30/09/2026', paid_installments: '2' },
    { ...context, editing: { id: 'tx' } });
  assert.equal(result.destino, 'converter');
  assert.equal(result.entradaParcelada?.totalCents, 10001);
  assert.equal(result.entradaParcelada?.paidInstallments, 2);
  assert.ok(!Object.hasOwn(result.entradaParcelada!, 'downPayment'));
  assert.equal(prepararLancamento({ ...values, installments: 3 }, {
    ...context, editing: { id: 'tx', installment_plan_id: 'plan' },
  }).destino, 'salvar');
});

test('conta ausente não prepara compra; campos de entrada escondidos não vazam', () => {
  const result = prepararLancamento({ ...values, account_id: null, down_payment_enabled: true,
    down_payment_cents: -1, down_payment_date: 'inválida' }, { ...context, podeParcelarAqui: false });
  assert.equal(result.entradaParcelada, null);
  assert.equal(result.destino, 'salvar');
});

test('dados obrigatórios inválidos são recusados antes da prévia financeira', () => {
  for (const patch of [{ amount_cents: 0 }, { amount_cents: 1.5 }, { amount_cents: Number.MAX_SAFE_INTEGER + 1 },
    { description: '  ' }, { occurred_at: '31/02/2026' }, { installments: 0 }, { installments: 73 }]) {
    assert.throws(() => prepararLancamento({ ...values, ...patch }, context));
  }
  assert.throws(() => prepararLancamento({ ...values, pending: true, due_at: '31/02/2026' }, context));
  assert.throws(() => prepararLancamento({ ...values, pending: true, due_at: '01/10/2026' }, context));
});

test('histórico passado em branco e entrada futura falham com a regra já existente', () => {
  assert.throws(() => prepararLancamento({ ...values, installments: 3, occurred_at: '30/09/2026', paid_installments: '' }, context), /quantas parcelas/);
  assert.throws(() => prepararLancamento({ ...values, installments: 3, down_payment_enabled: true,
    down_payment_date: '03/10/2026' }, context), /data futura/);
  assert.throws(() => prepararLancamento({ ...values, installments: 3, down_payment_enabled: true,
    down_payment_cents: 10000 }, context), /pelo menos/);
});

const detail = '33333333-3333-4333-8333-333333333333';
test('F09 principal conserva detalhe explícito e parcelada usa o mesmo UUID; transferência limpa', () => {
  const input = { ...values, subcategory_id: detail, installments: 3, down_payment_enabled: true };
  const result = prepararLancamento(input, context);
  assert.equal(result.entradaLancamento.subcategory_id, detail);
  assert.equal(result.entradaParcelada?.subcategory_id, detail);
  assert.equal(Object.hasOwn(result.entradaParcelada!.downPayment!, 'subcategory_id'), false);
  assert.equal(prepararLancamento({ ...input, kind: 'transfer' }, context).entradaLancamento.subcategory_id, null);
  assert.equal(prepararLancamento({ ...values, subcategory_id: null }, context).entradaLancamento.subcategory_id, null);
});
test('F09 troca de pai limpa filho herdado; alias conserva e novo filho explícito fica para preflight', () => {
  const editing = { id: 'tx', category: 'casa', subcategory_id: detail };
  assert.equal(prepararLancamento({ ...values, category: 'saúde' }, { ...context, editing }).entradaLancamento.subcategory_id, null);
  assert.equal(Object.hasOwn(prepararLancamento(values, { ...context, editing }).entradaLancamento, 'subcategory_id'), false);
  assert.equal(prepararLancamento({ ...values, category: ' CASA ', subcategory_id: detail }, { ...context, editing }).entradaLancamento.subcategory_id, detail);
  const next = '44444444-4444-4444-8444-444444444444';
  assert.equal(prepararLancamento({ ...values, category: 'saúde', subcategory_id: next }, { ...context, editing }).entradaLancamento.subcategory_id, next);
});
test('F09 transferência editada limpa também filho novo explícito após comparar o snapshot', () => {
  const result = prepararLancamento({ ...values, kind: 'transfer', subcategory_id: '44444444-4444-4444-8444-444444444444' },
    { ...context, editing: { id: 'tx', category: 'casa', subcategory_id: detail } });
  assert.equal(result.entradaLancamento.subcategory_id, null);
});
