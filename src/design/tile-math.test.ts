import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ENCOLHE_ATE, empilhaLadrilhos, larguraMinimaDoLadrilho } from './tile-math.ts';

/**
 * O ladrilho só ocupa a linha inteira quando REALMENTE não cabe na metade (29/09/2026, *"somente
 * quando realmente for necessário"*): a palavra mais larga não parte e o valor não encolhe abaixo
 * de `ENCOLHE_ATE`. Medidas do iPhone 17 Pro: metade da linha = 179pt.
 */
const METADE = 179;
const RESPIRO = 16;

test('tamanho normal: Entra e Sai cabem lado a lado', () => {
  assert.ok(larguraMinimaDoLadrilho(40, 110, RESPIRO) <= METADE);
});

test('valor que precisaria encolher mais que o limite pede a linha inteira', () => {
  // "R$ 16.677,31" a 2,14× mede ~283pt: na metade, ficaria a 50%.
  assert.ok(larguraMinimaDoLadrilho(60, 283, RESPIRO) > METADE);
  // Encolher até o limite ainda cabe: fica lado a lado.
  assert.ok(larguraMinimaDoLadrilho(60, (METADE - 2 * RESPIRO) / ENCOLHE_ATE, RESPIRO) <= METADE);
});

test('palavra que não cabe na metade pede a linha inteira (nunca "Orçament/os")', () => {
  assert.ok(larguraMinimaDoLadrilho(190, 0, RESPIRO) > METADE);
});

test('a fileira empilha TODOS quando o maior mínimo não cabe na metade — e só então', () => {
  // 370 de fileira, 12 de vão: a metade é 179.
  assert.equal(empilhaLadrilhos(179, 370, 12), false);
  assert.equal(empilhaLadrilhos(180, 370, 12), true);
  // Antes de medir a largura, não decide nada (nasce lado a lado).
  assert.equal(empilhaLadrilhos(500, 0, 12), false);
});
