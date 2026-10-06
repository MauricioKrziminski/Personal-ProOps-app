import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apelidoParaExibir } from './apelidos.ts';

test('capitaliza só a primeira letra', () => {
  assert.equal(apelidoParaExibir('roxinho'), 'Roxinho');
  assert.equal(apelidoParaExibir(' cartao do banco '), 'Cartao do banco');
  assert.equal(apelidoParaExibir(''), '');
});
