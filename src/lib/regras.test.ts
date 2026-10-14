import assert from 'node:assert/strict';
import test from 'node:test';

import { separaRegras, tipoDaRegra } from './regras.ts';

test('regra com pasta é de nota; sem pasta é de lançamento', () => {
  assert.equal(tipoDaRegra({ folder_id: 'f1' }), 'nota');
  assert.equal(tipoDaRegra({ folder_id: null }), 'lancamento');
  assert.equal(tipoDaRegra({}), 'lancamento');
  const { lancamentos, notas } = separaRegras([{ id: 1, folder_id: 'f' }, { id: 2, folder_id: null }, { id: 3 }]);
  assert.deepEqual(lancamentos.map((r) => r.id), [2, 3]);
  assert.deepEqual(notas.map((r) => r.id), [1]);
});
