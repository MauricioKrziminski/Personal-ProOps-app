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

test('a recorrente diz de quanto em quanto tempo repete', () => {
  // 29/09/2026: "Academia · recorrente · R$ 50,00" não dizia que era SEMANAL.
  const rec = (rrule: string) => ({ id: 'r', tipo: 'recorrente' as const, titulo: 'Academia', entrada: { kind: 'expense' as const, amount_cents: 5000, description: 'Academia', merchant: null, category: null, account_id: null, rrule, next_run_at: '2026-10-06T12:00:00Z', end_date: null, auto_confirm: false } });
  assert.equal(resumoDaHipotese(rec('FREQ=WEEKLY;BYDAY=TU'), brl), 'Academia · toda semana · R$ 50.00');
  assert.equal(resumoDaHipotese(rec('FREQ=MONTHLY;BYMONTHDAY=5'), brl), 'Academia · todo mês · R$ 50.00');
  assert.equal(resumoDaHipotese(rec('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=5'), brl), 'Academia · a cada 3 meses · R$ 50.00');
  assert.equal(resumoDaHipotese(rec('FREQ=YEARLY'), brl), 'Academia · todo ano · R$ 50.00');
});

test('item estragado no aparelho sai do rascunho; o resto continua', async () => {
  // Revisão final, 29/09/2026: `lerRascunho` só conferia o envelope, e uma detalhada sem `entrada`
  // (ou uma rápida `null`) derrubava a Projeção inteira.
  const { detalhadasValidas } = await import('./rascunho.ts');
  const boa = { id: 'h1', tipo: 'parcelada', titulo: 'Notebook', entrada: parcelada.entrada };
  const lido = lerRascunho(JSON.stringify({ versao: 1, rapidas: [null, { kind: 'expense', amount_cents: 100, start: '2026-10-01', installments: 1 }, { kind: 'x' }], detalhadas: [boa, { id: 'h2', tipo: 'parcelada' }, { id: 'h3', tipo: 'outro', entrada: {} }, null] }));
  assert.equal(lido.rapidas.length, 1);
  assert.deepEqual(lido.detalhadas.map((h) => h.id), ['h1']);
  assert.deepEqual(detalhadasValidas([boa, { tipo: 'lancamento' }, 'x']).map((h) => h.id), ['h1']);
});
