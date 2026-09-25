/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planoDaBaixa } from './confirmar-baixa.ts';

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
