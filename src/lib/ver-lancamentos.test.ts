import assert from 'node:assert/strict';
import test from 'node:test';

import { totaisDoChip, verInicial } from './ver-lancamentos.ts';

const t = { entrou: 1000, saiu: 500, entrouPrevisto: 300, saiuPrevisto: 200 };

test('abre em Aconteceu, exceto onde o link promete o total com previsto', () => {
  assert.equal(verInicial(undefined), 'cleared');
  assert.equal(verInicial('todos'), 'all');
  assert.equal(verInicial('previsto'), 'pending');
  assert.equal(verInicial(undefined, 'serie-1'), 'all');
  assert.equal(verInicial(undefined, undefined, 'gasto'), 'all');
  assert.equal(verInicial('aconteceu', 'serie-1'), 'cleared');
});

test('os chips repartem o período: aconteceu + previsto = todos', () => {
  const a = totaisDoChip(t, 'cleared');
  const p = totaisDoChip(t, 'pending');
  assert.equal(a.entrou + p.entrou, t.entrou);
  assert.equal(a.saiu + p.saiu, t.saiu);
  assert.deepEqual(totaisDoChip(t, 'all'), t);
});
