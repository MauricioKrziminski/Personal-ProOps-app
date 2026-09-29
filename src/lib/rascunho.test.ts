import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RASCUNHO_VAZIO, gravarRascunho, lerRascunho, registrosParaSimular, resumoDaHipotese } from './rascunho.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const parcelada = {
  id: 'h1', tipo: 'parcelada' as const, titulo: 'Notebook',
  entrada: { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null },
};

test('ler e gravar vão e voltam; vazio grava texto vazio', () => {
  const r = { versao: 1 as const, rapidas: [{ kind: 'income' as const, amount_cents: 100, start: '2026-10-01', installments: 1 }], detalhadas: [parcelada] };
  assert.deepEqual(lerRascunho(gravarRascunho(r)), r);
  assert.equal(gravarRascunho(RASCUNHO_VAZIO), '');
});

test('formato velho ou corrompido não quebra: vira vazio', () => {
  assert.deepEqual(lerRascunho(''), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho('{nao é json'), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho(JSON.stringify({ versao: 99, rapidas: [], detalhadas: [] })), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho(JSON.stringify({ versao: 1, rapidas: 'x', detalhadas: null })), RASCUNHO_VAZIO);
});

test('registros para simular usam as funções da escrita', () => {
  assert.deepEqual(registrosParaSimular([parcelada]), [{
    tipo: 'parcelada',
    dados: { p_account_id: 'c', p_total_cents: 300000, p_installments: 10, p_paid_installments: 0, p_occurred_at: '2026-10-01', p_description: 'Notebook', p_category: undefined, p_merchant: undefined, ultimo_dia: false },
  }]);
});

test('a linha diz título, tipo e valor', () => {
  assert.equal(resumoDaHipotese(parcelada, brl), 'Notebook · compra 10× · R$ 3000.00');
});

test('o lançamento vira hipótese de compra parcelada quando o formulário parcelaria, e de lançamento no resto', async () => {
  const { hipoteseDoLancamento } = await import('./rascunho.ts');
  const lanc = { kind: 'expense' as const, amount_cents: 1000, category: null, description: 'Pão', merchant: null, account_id: 'c', counterparty_account_id: null, occurred_at: '2026-10-01', status: 'cleared' as const, due_at: null, auto_confirm: false, fee_cents: 0 };
  const parc = { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null };
  assert.deepEqual(hipoteseDoLancamento('criarPlano', lanc, parc), { tipo: 'parcelada', entrada: parc, titulo: 'Notebook' });
  assert.deepEqual(hipoteseDoLancamento('salvar', lanc, parc), { tipo: 'lancamento', entrada: lanc, titulo: 'Pão' });
  // sem título, um nome que diz o que é
  assert.equal(hipoteseDoLancamento('salvar', { ...lanc, description: '' }, null).titulo, 'Lançamento');
});
