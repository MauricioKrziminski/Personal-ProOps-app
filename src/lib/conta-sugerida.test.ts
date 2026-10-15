import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contaNoConflito, contaQuePaga, contaSugerida } from './conta-sugerida.ts';

const contas = [
  { id: 'c1', type: 'checking' },
  { id: 'd1', type: 'cash' },
  { id: 'k1', type: 'credit_card' },
  { id: 'old', type: 'checking', archived: true },
  { id: 'kold', type: 'credit_card', archived: true },
];
const base = { forma: null, contaPadrao: 'c1', cartaoPadrao: 'k1', contas } as const;

test('contexto vence, sem tocar', () => {
  assert.equal(contaSugerida({ ...base, contexto: 'zzz', forma: 'credit' }), 'zzz');
});
test('crédito usa o cartão padrão', () => {
  assert.equal(contaSugerida({ ...base, forma: 'credit' }), 'k1');
});
test('crédito sem cartão padrão, arquivado, ausente ou que não é cartão: null', () => {
  assert.equal(contaSugerida({ ...base, forma: 'credit', cartaoPadrao: null }), null);
  assert.equal(contaSugerida({ ...base, forma: 'credit', cartaoPadrao: 'kold' }), null);
  assert.equal(contaSugerida({ ...base, forma: 'credit', cartaoPadrao: 'sumiu' }), null);
  assert.equal(contaSugerida({ ...base, forma: 'credit', cartaoPadrao: 'c1' }), null);
});
test('pix, débito, boleto e transferência usam a conta padrão', () => {
  for (const forma of ['pix', 'debit', 'boleto', 'bank_transfer'] as const)
    assert.equal(contaSugerida({ ...base, forma }), 'c1');
});
test('dinheiro só com conta de dinheiro; débito não aceita dinheiro', () => {
  assert.equal(contaSugerida({ ...base, forma: 'cash' }), null);
  assert.equal(contaSugerida({ ...base, forma: 'cash', contaPadrao: 'd1' }), 'd1');
  assert.equal(contaSugerida({ ...base, forma: 'debit', contaPadrao: 'd1' }), null);
});
test('sem forma usa a conta padrão', () => {
  assert.equal(contaSugerida(base), 'c1');
});
test('conta padrão arquivada, ausente ou cartão: null', () => {
  assert.equal(contaSugerida({ ...base, contaPadrao: 'old' }), null);
  assert.equal(contaSugerida({ ...base, contaPadrao: 'sumiu' }), null);
  assert.equal(contaSugerida({ ...base, contaPadrao: 'k1' }), null);
  assert.equal(contaSugerida({ ...base, contaPadrao: null }), null);
});
test('quem paga: a própria, depois a padrão, só entre pagadoras ativas', () => {
  const pag = contas.filter((c) => c.type !== 'credit_card');
  assert.equal(contaQuePaga('d1', 'c1', pag), 'd1');
  assert.equal(contaQuePaga(null, 'c1', pag), 'c1');
  assert.equal(contaQuePaga('old', 'c1', pag), 'c1');
  assert.equal(contaQuePaga(null, 'old', pag), null);
  assert.equal(contaQuePaga(null, 'k1', contas), null);
  assert.equal(contaQuePaga(null, null, pag), null);
});

test('conflito: corrente no crédito vira o cartão padrão; cartão no débito vira a conta padrão', () => {
  assert.equal(contaNoConflito({ ...base, forma: 'credit', valor: 'c1' }), 'k1');
  assert.equal(contaNoConflito({ ...base, forma: 'debit', valor: 'k1' }), 'c1');
});
test('conflito: conta compatível, campo vazio ou sem padrão compatível não mexe', () => {
  assert.equal(contaNoConflito({ ...base, forma: 'pix', valor: 'c1' }), null);
  assert.equal(contaNoConflito({ ...base, forma: 'credit', valor: null }), null);
  assert.equal(contaNoConflito({ ...base, forma: 'credit', valor: 'c1', cartaoPadrao: null }), null);
});
