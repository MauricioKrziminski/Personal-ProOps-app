import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  displayPhoneBR,
  formatPhoneBR,
  isValidPhoneBR,
  phoneDigits,
  toE164BR,
} from './phone-br.ts';

test('máscara progressiva acompanha a digitação', () => {
  assert.equal(formatPhoneBR(''), '');
  assert.equal(formatPhoneBR('1'), '(1');
  assert.equal(formatPhoneBR('11'), '(11');
  assert.equal(formatPhoneBR('119'), '(11) 9');
  assert.equal(formatPhoneBR('11999'), '(11) 999');
  assert.equal(formatPhoneBR('1199998'), '(11) 9999-8');
  assert.equal(formatPhoneBR('11999998888'), '(11) 99999-8888');
});

test('fixo de 10 dígitos quebra o hífen num lugar diferente do celular', () => {
  assert.equal(formatPhoneBR('1133334444'), '(11) 3333-4444');
  assert.equal(formatPhoneBR('11933334444'), '(11) 93333-4444');
});

test('DDI só é removido quando sobra número demais para ser nacional', () => {
  // 13 dígitos: DDI + DDD + celular.
  assert.equal(phoneDigits('+5511999998888'), '11999998888');
  // 55 é DDD de Santa Maria/RS — em 10 dígitos ele NÃO é DDI.
  assert.equal(phoneDigits('5599998888'), '5599998888');
  assert.equal(phoneDigits('55999998888'), '55999998888');
});

test('lixo e excesso não passam', () => {
  assert.equal(phoneDigits('abc'), '');
  assert.equal(phoneDigits('11 99999-8888 ramal 20'), '11999998888');
});

test('validade cobre o que o botão precisa saber', () => {
  assert.equal(isValidPhoneBR('(11) 99999-8888'), true);
  assert.equal(isValidPhoneBR('(11) 3333-4444'), true);
  assert.equal(isValidPhoneBR('11 9999-888'), false, 'curto demais');
  assert.equal(isValidPhoneBR('(09) 99999-8888'), false, 'DDD não existe abaixo de 11');
  assert.equal(isValidPhoneBR('(11) 89999-8888'), false, 'celular BR começa com 9');
});

test('E.164 e exibição saem da mesma normalização', () => {
  assert.equal(toE164BR('(11) 99999-8888'), '+5511999998888');
  assert.equal(toE164BR('+55 11 99999-8888'), '+5511999998888');
  assert.equal(displayPhoneBR('11999998888'), '+55 (11) 99999-8888');
});
