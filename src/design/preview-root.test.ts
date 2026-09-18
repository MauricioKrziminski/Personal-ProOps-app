import assert from 'node:assert/strict';
import { test } from 'node:test';

import { previewRootFromParam } from './preview-root.ts';

test('QA deep links select only the five tab roots', () => {
  assert.equal(previewRootFromParam('today'), 'Hoje');
  assert.equal(previewRootFromParam('finance'), 'Finanças');
  assert.equal(previewRootFromParam('notes'), 'Notas');
  assert.equal(previewRootFromParam('agent'), 'Agente');
  assert.equal(previewRootFromParam('profile'), 'Perfil');
  assert.equal(previewRootFromParam('invoice'), null);
  assert.equal(previewRootFromParam(undefined), null);
});
