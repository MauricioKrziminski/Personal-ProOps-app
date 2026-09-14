import assert from 'node:assert/strict';
import { test } from 'node:test';

import { faceKey, strikeOf } from './note-face.ts';

/**
 * A matriz peso × itálico falha em SILÊNCIO: chave errada desenha o regular com negrito
 * sintético no Android, e ninguém vê isso no simulador do iOS.
 */

test('negrito sobe o peso, itálico escolhe a face inclinada', () => {
  assert.equal(faceKey([]), 'regular');
  assert.equal(faceKey(['bold']), 'bold');
  assert.equal(faceKey(['italic']), 'italic');
  assert.equal(faceKey(['bold', 'italic']), 'boldItalic');
});

test('negrito dentro de um título (600) sobe para 700 — senão não faz nada visível', () => {
  assert.equal(faceKey([], 600), 'semibold');
  assert.equal(faceKey(['italic'], 600), 'semiboldItalic');
  assert.equal(faceKey(['bold'], 600), 'bold');
  assert.equal(faceKey(['bold', 'italic'], 600), 'boldItalic');
});

test('mono ganha da combinação inteira', () => {
  assert.equal(faceKey(['code']), 'mono');
  assert.equal(faceKey(['code', 'bold', 'italic'], 600), 'mono');
});

test('riscado é decoração, não família', () => {
  assert.equal(faceKey(['strike']), 'regular');
  assert.equal(faceKey(['strike', 'bold']), 'bold');
  assert.equal(strikeOf(['strike']), 'line-through');
  assert.equal(strikeOf(['bold']), undefined);
});
