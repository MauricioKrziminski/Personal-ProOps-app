import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canalDoPerfil } from './canal-do-lembrete.ts';

test('o lembrete novo nasce no canal do Perfil', () => {
  assert.equal(canalDoPerfil({ push: true, whatsapp: false }), 'push');
  assert.equal(canalDoPerfil({ push: false, whatsapp: true }), 'whatsapp');
  assert.equal(canalDoPerfil({ push: true, whatsapp: true }), 'both');
  assert.equal(canalDoPerfil({ push: false, whatsapp: false }), 'both');
  assert.equal(canalDoPerfil(undefined), 'both');
});
