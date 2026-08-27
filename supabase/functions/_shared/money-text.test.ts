/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseValorEmCentavos } from './money-text.ts';

test('o caso que motivou o parser: aporte sem valor devolvido pela IA', () => {
  assert.equal(parseValorEmCentavos('coloca 200 na meta da viagem'), 20000);
  assert.equal(parseValorEmCentavos('guardei 500 pra viagem'), 50000);
});

test('formato brasileiro e americano chegam no mesmo inteiro', () => {
  assert.equal(parseValorEmCentavos('gastei 1.234,56 no mercado'), 123456);
  assert.equal(parseValorEmCentavos('gastei 1234.56 no mercado'), 123456);
  assert.equal(parseValorEmCentavos('paguei 45,90'), 4590);
  assert.equal(parseValorEmCentavos('R$ 320,55 no zaffari'), 32055);
});

test('mil e milhão viram centavos', () => {
  assert.equal(parseValorEmCentavos('meu tesouro ta em 27 mil'), 2700000);
  assert.equal(parseValorEmCentavos('o carro vale 1,5 mil'), 150000);
  assert.equal(parseValorEmCentavos('o apartamento vale 2 milhoes'), 200000000);
});

test('ignora número que não é dinheiro', () => {
  // "12x" é parcela, sobra só o 3600
  assert.equal(parseValorEmCentavos('parcelei 3600 em 12x'), 360000);
  // "dia 5" é recorrência, sobra só o 1200
  assert.equal(parseValorEmCentavos('todo dia 5 pago 1200 de aluguel'), 120000);
  assert.equal(parseValorEmCentavos('me lembra as 8h de pagar 90'), 9000);
});

test('com mais de um valor plausível, devolve null em vez de chutar', () => {
  assert.equal(parseValorEmCentavos('gastei 45 no mercado e 30 no uber'), null);
  assert.equal(parseValorEmCentavos('na verdade foi 54 e nao 45'), null);
});

test('sem número nenhum, devolve null', () => {
  assert.equal(parseValorEmCentavos('coloca na meta da viagem'), null);
  assert.equal(parseValorEmCentavos(''), null);
  assert.equal(parseValorEmCentavos(null), null);
  assert.equal(parseValorEmCentavos('quanto tenho de saldo?'), null);
});

test('zero e negativo não viram valor', () => {
  assert.equal(parseValorEmCentavos('coloca 0 na meta'), null);
});
