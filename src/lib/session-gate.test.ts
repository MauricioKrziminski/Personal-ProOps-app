import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  VALIDADE_DA_ORIGEM_MS,
  ondaDaTroca,
  origemValida,
  precisaDeCortina,
} from './session-gate.ts';

test('a primeira sessão resolvida é a abertura, não uma troca', () => {
  assert.equal(precisaDeCortina(undefined, null), false);
  assert.equal(precisaDeCortina(undefined, 'u1'), false);
});

test('mesmo usuário (refresh de token, metadados do onboarding) passa direto', () => {
  assert.equal(precisaDeCortina('u1', 'u1'), false);
  assert.equal(precisaDeCortina(null, null), false);
});

test('entrar, sair e trocar de conta passam pela cortina', () => {
  assert.equal(precisaDeCortina(null, 'u1'), true);
  assert.equal(precisaDeCortina('u1', null), true);
  assert.equal(precisaDeCortina('u1', 'u2'), true);
});

test('sair cobre de baixo, mesmo com uma origem lembrada', () => {
  assert.deepEqual(ondaDaTroca(null, null), { mode: 'up' });
  assert.deepEqual(ondaDaTroca(null, { x: 0.5, y: 0.8 }), { mode: 'up' });
});

test('entrar com botão nasce no botão; sem botão, do topo', () => {
  assert.deepEqual(ondaDaTroca('u1', { x: 0.5, y: 0.8 }), {
    mode: 'radial',
    origin: { x: 0.5, y: 0.8 },
  });
  assert.deepEqual(ondaDaTroca('u1', null), { mode: 'down' });
});

test('a origem lembrada vence depois de um tempo', () => {
  const r = { ponto: { x: 0.3, y: 0.9 }, em: 1000 };
  assert.deepEqual(origemValida(r, 1000 + VALIDADE_DA_ORIGEM_MS), r.ponto);
  assert.equal(origemValida(r, 1001 + VALIDADE_DA_ORIGEM_MS), null);
  assert.equal(origemValida(null, 1000), null);
});
