import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parcelaDoContratoPaga, previstoDaLinha } from './previsto.ts';

test('previstoDaLinha: só na linha PAGA com valor diferente do previsto', () => {
  assert.equal(previstoDaLinha({ status: 'cleared', amount_cents: 11000, expected_amount_cents: 12000 }), 12000);
  // a RPC/PostgREST pode mandar bigint como string
  assert.equal(previstoDaLinha({ status: 'cleared', amount_cents: '11000', expected_amount_cents: '12000' }), 12000);
  assert.equal(previstoDaLinha({ status: 'cleared', amount_cents: 12000, expected_amount_cents: 12000 }), null, 'igual não diz nada');
  assert.equal(previstoDaLinha({ status: 'cleared', amount_cents: 12000, expected_amount_cents: null }), null);
  assert.equal(previstoDaLinha({ status: 'cleared', amount_cents: 12000 }), null, 'coluna ausente (app/APK antigo)');
  assert.equal(previstoDaLinha({ status: 'pending', amount_cents: 11000, expected_amount_cents: 12000 }), null, 'em aberto o valor É o previsto');
});

test('parcelaDoContratoPaga: dívida de parcela fixa paga com outro valor mostra a parcela do contrato', () => {
  assert.equal(parcelaDoContratoPaga({ amount_cents: 85015, debt_principal_cents: 86015 }, false), 86015);
  assert.equal(parcelaDoContratoPaga({ amount_cents: 86015, debt_principal_cents: 86015 }, false), null, 'no valor, nada');
  assert.equal(parcelaDoContratoPaga({ amount_cents: 85015, debt_principal_cents: null }, false), null, 'sem contrato gravado');
  // com juros o principal é AMORTIZAÇÃO, não "a parcela": comparar seria mentir
  assert.equal(parcelaDoContratoPaga({ amount_cents: 85015, debt_principal_cents: 60000 }, true), null);
});
