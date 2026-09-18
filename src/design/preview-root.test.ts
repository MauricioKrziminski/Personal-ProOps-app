import assert from 'node:assert/strict';
import { test } from 'node:test';

import { previewRootFromParam, previewScreenFromParam } from './preview-root.ts';

test('QA deep links select only the five tab roots', () => {
  assert.equal(previewRootFromParam('today'), 'Hoje');
  assert.equal(previewRootFromParam('finance'), 'Finanças');
  assert.equal(previewRootFromParam('notes'), 'Notas');
  assert.equal(previewRootFromParam('agent'), 'Agente');
  assert.equal(previewRootFromParam('profile'), 'Perfil');
  assert.equal(previewRootFromParam('invoice'), null);
  assert.equal(previewRootFromParam(undefined), null);
});

test('QA can open the real invoice route without exposing pushed-route chrome', () => {
  assert.equal(previewScreenFromParam('invoice'), 'Fatura');
  assert.equal(previewScreenFromParam('forecast'), 'Projeção');
  assert.equal(previewScreenFromParam('net-worth'), 'Patrimônio');
  assert.equal(previewScreenFromParam('cycle'), 'Ciclo');
  assert.equal(previewScreenFromParam('reports'), 'Relatórios');
  assert.equal(previewScreenFromParam('notes'), 'Notas');
  assert.equal(previewScreenFromParam('unknown'), null);
});
