import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baldeDaOrigem, lerDetalheDoCiclo, rotulosDoDetalhe, saidasPorBalde } from './detalhe-do-ciclo.ts';

const json = {
  estado: 'aberto', ini: '2026-09-11', fim: '2026-10-10',
  partida: { tipo: 'contas', cents: '420000', contas: [
    { account_id: 'a', nome: 'Corrente', tipo: 'checking', cents: 300000 },
    { account_id: null, nome: 'Sem conta', tipo: null, cents: '120000' },
  ] },
  entra: 250000, sai: '135000',
  por_origem: [
    { origin: 'transaction', in_cents: 250000, out_cents: 90000 },
    { origin: 'invoice', in_cents: 0, out_cents: 30000 },
    { origin: 'invoice_payment', in_cents: 0, out_cents: 5000 },
    { origin: 'debt_schedule', in_cents: 0, out_cents: 10000 },
  ],
  resultado: 535000, caixa_no_fim: null, faltou_pagar: null,
};

test('detalhe do ciclo: bigint em texto vira número e a conta fecha', () => {
  const d = lerDetalheDoCiclo(json);
  assert.equal(d.partida.cents, 420000);
  assert.equal(d.partida.contas[1].cents, 120000);
  assert.equal(d.sai, 135000);
  assert.equal(d.partida.cents + d.entra - d.sai, d.resultado);
  assert.equal(d.caixaNoFim, null);
});

test('detalhe do ciclo: saídas por balde, na ordem da tela, somando o "sai"', () => {
  const baldes = saidasPorBalde(lerDetalheDoCiclo(json));
  assert.deepEqual(baldes, [
    { titulo: 'Faturas de cartão', cents: 35000 },
    { titulo: 'Boletos, pix e gastos', cents: 90000 },
    { titulo: 'Parcelas de financiamento', cents: 10000 },
  ]);
  assert.equal(baldes.reduce((s, b) => s + b.cents, 0), 135000);
});

test('detalhe do ciclo: o balde de uma origem é o da tela do ciclo', () => {
  assert.equal(baldeDaOrigem('invoice', true), 'Entradas');
  assert.equal(baldeDaOrigem('hipotese', true), 'Hipóteses do rascunho');
  assert.equal(baldeDaOrigem('recurring_projection', false), 'Previstos da recorrência');
  assert.equal(baldeDaOrigem('transaction', false), 'Boletos, pix e gastos');
});

test('detalhe do ciclo: o aberto fala do que ainda vai acontecer', () => {
  assert.equal(rotulosDoDetalhe('aberto').partida, 'Em conta hoje');
  assert.equal(rotulosDoDetalhe('previsto').partida, 'Veio do ciclo anterior');
  assert.equal(rotulosDoDetalhe('fechado').fim, 'Sobrou na conta');
});
