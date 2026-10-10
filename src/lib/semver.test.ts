import assert from 'node:assert/strict';
import { test } from 'node:test';

import { abaixoDe, compararVersoes, lerVersao } from './semver.ts';

test('semver: compara numericamente, não por texto', () => {
  assert.equal(compararVersoes('1.11.0', '1.9.0'), 1, '11 > 9');
  assert.equal(compararVersoes('1.2.3', '1.2.3'), 0);
  assert.equal(compararVersoes('1.2.3', '1.2.4'), -1);
  assert.equal(compararVersoes('2.0.0', '1.99.99'), 1);
});

test('semver: abaixoDe só vale entre versões legíveis (falha aberto)', () => {
  assert.equal(abaixoDe('1.4.0', '1.5.0'), true);
  assert.equal(abaixoDe('1.5.0', '1.5.0'), false);
  assert.equal(abaixoDe('1.5.1', '1.5.0'), false);
  assert.equal(abaixoDe(null, '1.5.0'), false, 'versão nativa ausente não bloqueia');
  assert.equal(abaixoDe('1.4.0', null), false, 'sem mínimo não bloqueia');
  assert.equal(abaixoDe('1.4.0', 'abc'), false);
  assert.equal(abaixoDe('1.4', '1.5.0'), false, 'só MAJOR.MINOR.PATCH');
});

test('semver: lerVersao rejeita lixo', () => {
  assert.deepEqual(lerVersao(' 1.2.3 '), [1, 2, 3]);
  assert.equal(lerVersao('1.2.3-beta'), null);
  assert.equal(lerVersao(''), null);
});
