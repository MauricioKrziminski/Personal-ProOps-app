import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cornerKeep,
  inkPose,
  motifPose,
  patterned,
  seeded,
  tileGrid,
  tilePhase,
  tilePiece,
  tileTurns,
  waveOrder,
} from './tile-math.ts';

test('a grade cobre a largura sem sobra e a altura inteira', () => {
  const g = tileGrid(402, 874);
  assert.equal(g.cols, 8);
  assert.ok(Math.abs(g.cols * g.size - 402) < 1e-9);
  assert.ok(g.rows * g.size >= 874);
  assert.ok((g.rows - 1) * g.size < 874, 'nenhuma linha inteira sobra fora da área');
  assert.equal(g.count, g.cols * g.rows);
});

test('a grade nunca é vazia, mesmo antes de medir', () => {
  const g = tileGrid(0, 0);
  assert.ok(g.cols >= 1 && g.rows >= 1 && g.size > 0);
});

test('a semente é determinística, espalhada e fica em [0, 1)', () => {
  assert.equal(seeded(5, 42), seeded(5, 42));
  assert.notEqual(seeded(5, 42), seeded(6, 42));
  assert.notEqual(seeded(5, 42), seeded(5, 43));
  for (let i = 0; i < 500; i++) {
    const v = seeded(i, 7);
    assert.ok(v >= 0 && v < 1, String(v));
  }
});

test('as quatro peças e os quatro giros aparecem', () => {
  const pecas = new Set(Array.from({ length: 64 }, (_, i) => tilePiece(i, 42)));
  const giros = new Set(Array.from({ length: 64 }, (_, i) => tileTurns(i, 42)));
  assert.deepEqual([...pecas].sort(), [0, 1, 2, 3]);
  assert.deepEqual([...giros].sort(), [0, 1, 2, 3]);
});

test('a onda diagonal começa no canto da origem e termina no oposto', () => {
  assert.equal(waveOrder(0, 0, 8, 18, 'diagonal', 0, 0), 0);
  assert.equal(waveOrder(7, 17, 8, 18, 'diagonal', 0, 0), 1);
  assert.equal(waveOrder(7, 17, 8, 18, 'diagonal', 1, 1), 0);
  assert.equal(waveOrder(0, 0, 8, 18, 'diagonal', 1, 1), 1);
});

test('a onda radial nasce na origem e cresce com a distância', () => {
  const centro = waveOrder(4, 9, 9, 19, 'radial', 0.5, 0.5);
  const meio = waveOrder(2, 9, 9, 19, 'radial', 0.5, 0.5);
  const canto = waveOrder(0, 0, 9, 19, 'radial', 0.5, 0.5);
  assert.equal(centro, 0);
  assert.ok(meio > centro && canto > meio);
  assert.ok(canto > 0.99 && canto <= 1);
});

test('up começa embaixo, down começa em cima', () => {
  assert.equal(waveOrder(3, 17, 8, 18, 'up'), 0);
  assert.equal(waveOrder(3, 0, 8, 18, 'up'), 1);
  assert.equal(waveOrder(3, 0, 8, 18, 'down'), 0);
  assert.equal(waveOrder(3, 17, 8, 18, 'down'), 1);
});

test('o ruído da semente mantém a ordem em [0, 1] e preserva as pontas', () => {
  for (let r = 0; r < 18; r++) {
    for (let c = 0; c < 8; c++) {
      const o = waveOrder(c, r, 8, 18, 'diagonal', 0, 0, 1952);
      assert.ok(o >= 0 && o <= 1, `${c},${r} = ${o}`);
    }
  }
  assert.equal(waveOrder(0, 0, 8, 18, 'diagonal', 0, 0, 1952), 0);
  assert.equal(waveOrder(7, 17, 8, 18, 'diagonal', 0, 0, 1952), 1);
});

test('a fase é 0 antes da janela, 1 depois, e toda janela cabe em [0, 1]', () => {
  for (const order of [0, 0.3, 0.7, 1]) {
    assert.equal(tilePhase(0, order), 0);
    assert.equal(tilePhase(1, order), 1);
  }
  assert.ok(tilePhase(0.2, 0) > 0);
  assert.equal(tilePhase(0.2, 1), 0);
  assert.ok(tilePhase(0.5, 0.2) > tilePhase(0.5, 0.8));
});

test('a tinta some na metade da janela e o motivo floresce e some', () => {
  assert.deepEqual(inkPose(0), { scale: 1, angle: 0 });
  assert.equal(inkPose(0.5).scale, 0);
  assert.equal(inkPose(1).scale, 0);
  assert.equal(motifPose(0).scale, 0);
  assert.equal(motifPose(0.15).scale, 0);
  assert.equal(motifPose(0.5).scale, 1);
  assert.equal(motifPose(1).scale, 0);
  assert.ok(Math.abs(motifPose(0.999).angle - Math.PI / 2) < 0.01);
});

test('as poses são contínuas: nenhum salto maior que 5% entre dois quadros vizinhos', () => {
  for (let i = 1; i <= 600; i++) {
    const a = i / 600;
    const b = (i - 1) / 600;
    assert.ok(Math.abs(inkPose(a).scale - inkPose(b).scale) < 0.05, `tinta em ${a}`);
    assert.ok(Math.abs(motifPose(a).scale - motifPose(b).scale) < 0.05, `motivo em ${a}`);
  }
});

test('o canto guarda um triângulo em degraus no alto à direita', () => {
  const guardados: string[] = [];
  for (let r = 0; r < 18; r++) {
    for (let c = 0; c < 8; c++) if (cornerKeep(c, r, 8, 3)) guardados.push(`${c},${r}`);
  }
  assert.deepEqual(guardados, ['5,0', '6,0', '7,0', '6,1', '7,1', '7,2']);
  assert.equal(cornerKeep(7, 0, 8, 0), false);
});

test('cerca de um terço dos azulejos parados mostra o motivo', () => {
  const n = Array.from({ length: 300 }, (_, i) => patterned(i, 3)).filter(Boolean).length;
  assert.ok(n > 60 && n < 150, String(n));
});
