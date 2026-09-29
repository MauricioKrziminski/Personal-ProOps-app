import assert from 'node:assert/strict';
import { test } from 'node:test';

import { valorAnimadoCabe } from './count-up.ts';

/**
 * O número do herói conta num `TextInput`, que NÃO encolhe; o que não cabe vai para `<Money>`,
 * que encolhe. 29/09/2026, iPhone em accessibility-large (≈1,94×): "R$ 32.227,69" virava só "R$".
 */
test('o valor animado só fica com o TextInput quando cabe na fonte do sistema', () => {
  // A régua medida: 13 glifos a 1,3× (R$ 999.999,99 a 384dp); o sinal é o 14º.
  assert.equal(valorAnimadoCabe(99999999, 1.3), true);
  assert.equal(valorAnimadoCabe(-99999999, 1.3), false);
  assert.equal(valorAnimadoCabe(3222769, 1), true);
  // Fonte grande: o mesmo valor desce para o <Money>, que encolhe.
  assert.equal(valorAnimadoCabe(3222769, 1.94), false);
  assert.equal(valorAnimadoCabe(3222769, 1.6), false);
  // Abaixo de 1,3× a régua não afrouxa além do que foi medido.
  assert.equal(valorAnimadoCabe(100000000000, 1), false);
});
