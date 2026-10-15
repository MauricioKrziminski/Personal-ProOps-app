import assert from 'node:assert/strict';
import test from 'node:test';
import { faltaDepoisDeDesfazer, mensagemDeDesfazer, naOrdemDoPagamento, nomeDoPagamento } from './pagamentos-da-fatura.ts';

const fmt = (c: number) => `R$ ${c}`;

test('falta depois de desfazer soma o pagamento de volta, sem passar do total', () => {
  assert.equal(faltaDepoisDeDesfazer(1000, 1000, 300), 300);
  assert.equal(faltaDepoisDeDesfazer(1000, 600, 200), 600);
  assert.equal(faltaDepoisDeDesfazer(1000, 100, 500), 1000);
});

test('mensagem de desfazer', () => {
  assert.equal(mensagemDeDesfazer(300, 'Conta', 300, fmt), 'R$ 300 volta para Conta. A fatura fica com R$ 300 em aberto.');
});

test('na ordem do pagamento: data, depois a hora do registro; o 1º é o mais antigo', () => {
  const ps = [
    { id: 'c', occurred_at: '2026-10-07', created_at: '2026-10-07T12:00:00Z' },
    { id: 'b', occurred_at: '2026-10-05', created_at: '2026-10-05T18:00:00Z' },
    { id: 'a', occurred_at: '2026-10-05', created_at: '2026-10-05T08:00:00Z' },
  ];
  assert.deepEqual(naOrdemDoPagamento(ps).map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(ps[0].id, 'c', 'não muda a lista de entrada');
  assert.equal(nomeDoPagamento(0), '1º pagamento');
});
