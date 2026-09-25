/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { correcaoDoPagamento, pagamentoDaParcelaFixa, planoDaBaixa } from './confirmar-baixa.ts';

/**
 * "Paguei" confirma o valor (25/09/2026, pedido do dono do produto: *"às vezes eu posso ter pago
 * menos ou mais"*). O mesmo valor só dá baixa; outro valor corrige antes — só este lançamento, ou
 * este e os próximos da série quando a pessoa liga "Usar este valor nas próximas".
 */
test('mesmo valor: só dá baixa, sem corrigir nada', () => {
  assert.deepEqual(planoDaBaixa({ previsto: 21000, pago: 21000, temSerie: true, nasProximas: true }), {
    corrigir: null,
  });
});

test('outro valor: corrige só este lançamento', () => {
  assert.deepEqual(planoDaBaixa({ previsto: 21000, pago: 23000, temSerie: false, nasProximas: false }), {
    corrigir: { scope: 'one', amount_cents: 23000 },
  });
});

test('outro valor numa série com "nas próximas": corrige este e os próximos', () => {
  assert.deepEqual(planoDaBaixa({ previsto: 150000, pago: 152000, temSerie: true, nasProximas: true }), {
    corrigir: { scope: 'future', amount_cents: 152000 },
  });
});

test('"nas próximas" sem série não existe: vale só este', () => {
  assert.deepEqual(planoDaBaixa({ previsto: 21000, pago: 19000, temSerie: false, nasProximas: true }), {
    corrigir: { scope: 'one', amount_cents: 19000 },
  });
});

test('valor zero ou negativo não dá baixa', () => {
  assert.throws(() => planoDaBaixa({ previsto: 21000, pago: 0, temSerie: false, nasProximas: false }));
});

/**
 * Parcela fixa paga com outro valor (25/09/2026, `20260925120000`): conta UMA parcela e a
 * diferença é encargo (a mais) ou desconto (a menos). Os limites são os do banco — a tela avisa
 * antes, em vez de o erro chegar depois do toque.
 */
test('parcela fixa: a mais é encargo, a menos é desconto, igual não tem diferença', () => {
  assert.deepEqual(pagamentoDaParcelaFixa(147000, 150000), { diferenca: 3000, erro: null });
  assert.deepEqual(pagamentoDaParcelaFixa(147000, 145000), { diferenca: -2000, erro: null });
  assert.deepEqual(pagamentoDaParcelaFixa(147000, 147000), { diferenca: 0, erro: null });
});

test('parcela fixa: da metade até menos do dobro; fora disso diz por quê', () => {
  assert.equal(pagamentoDaParcelaFixa(10000, 5000).erro, null);
  assert.equal(pagamentoDaParcelaFixa(10000, 19999).erro, null);
  assert.match(pagamentoDaParcelaFixa(10000, 4999).erro ?? '', /metade da parcela/);
  assert.match(pagamentoDaParcelaFixa(10000, 20000).erro ?? '', /passa de uma parcela/);
});

/**
 * Corrigir o valor de um pagamento de dívida no "Editar lançamento" (25/09/2026): *"ao tentar
 * fazer isso e salvar, ele não salva, não faz nada… era para ele perguntar se é para editar todas
 * as parcelas do financiamento, somente aquela"*.
 */
const fixa = { calculation_mode: 'fixed_installments' as const, installments: 48, installments_paid: 9, installment_cents: 147000, remaining_cents: 147000 * 39 };
const pago = { amount_cents: 147000, debt_payment_no: 9, debt_principal_cents: 147000, debt_balance_after_cents: 147000 * 39 };

test('pagamento de parcela fixa: valor novo dentro do limite pergunta se vale para as próximas', () => {
  assert.deepEqual(correcaoDoPagamento(fixa, pago, 150000), { erro: null, perguntaAsProximas: true });
  // Voltar ao valor do contrato não tem o que propagar.
  assert.deepEqual(correcaoDoPagamento(fixa, { ...pago, amount_cents: 150000 }, 147000), { erro: null, perguntaAsProximas: false });
  // Sem mudar o valor, nada a dizer.
  assert.deepEqual(correcaoDoPagamento(fixa, pago, 147000), { erro: null, perguntaAsProximas: false });
});

test('pagamento de parcela fixa: fora do limite diz por quê, e vale em pagamento ANTIGO também', () => {
  const antigo = { ...pago, debt_payment_no: 3, debt_balance_after_cents: 147000 * 45 };
  assert.match(correcaoDoPagamento(fixa, antigo, 300000).erro ?? '', /passa de uma parcela/);
  assert.equal(correcaoDoPagamento(fixa, antigo, 150000).erro, null, 'no modo fixo o saldo não depende do valor');
});

test('dívida com juros: só o pagamento mais recente muda de valor', () => {
  const juros = { ...fixa, calculation_mode: 'amortized' as const };
  assert.equal(correcaoDoPagamento(juros, pago, 150000).erro, null);
  assert.equal(correcaoDoPagamento(juros, pago, 150000).perguntaAsProximas, false, 'a Price recalcula as próximas sozinha');
  assert.match(correcaoDoPagamento(juros, { ...pago, debt_payment_no: 3 }, 150000).erro ?? '', /mais recente/);
});

test('pagamento sem o histórico da dívida não muda de valor por aqui', () => {
  assert.match(correcaoDoPagamento(fixa, { ...pago, debt_principal_cents: null }, 150000).erro ?? '', /histórico/);
});
