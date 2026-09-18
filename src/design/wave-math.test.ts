import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAPA,
  alturaDaCapa,
  amplitude,
  bordaDaOnda,
  easeInOut,
  pontosDaCurva,
  progressoDaCapa,
  raioDaCobertura,
} from './wave-math.ts';

const H = 874;
const W = 402;

/** O ponto mais alto e o mais baixo que a curva pode tocar (o casco dos pontos de controle). */
function casco(base: number, A: number) {
  const c = pontosDaCurva(base, W, A);
  const ys = [c.y0, c.c1y, c.c2y, c.y1];
  return { topo: Math.min(...ys), fundo: Math.max(...ys) };
}

test('cobrir: em 1 não há nada na tela, em 0 a tela inteira está coberta', () => {
  // A forma de cobrir é a região ABAIXO da curva.
  const A1 = amplitude(1, H);
  assert.ok(casco(bordaDaOnda(1, 'cobrir', H, A1), A1).topo >= H, 'em 1 a curva fica abaixo da tela');
  const A0 = amplitude(0, H);
  assert.ok(casco(bordaDaOnda(0, 'cobrir', H, A0), A0).fundo <= 0, 'em 0 a curva fica acima da tela');
});

test('revelar: em 0 a tela inteira está coberta, em 1 não há nada', () => {
  // A forma de revelar é a região ACIMA da curva.
  const A0 = amplitude(0, H);
  assert.ok(casco(bordaDaOnda(0, 'revelar', H, A0), A0).topo >= H, 'em 0 a curva fica abaixo da tela');
  const A1 = amplitude(1, H);
  assert.ok(casco(bordaDaOnda(1, 'revelar', H, A1), A1).fundo <= 0, 'em 1 a curva fica acima da tela');
});

test('as duas fases andam para CIMA: a borda sobe enquanto a cobertura cresce e enquanto some', () => {
  let antes = Infinity;
  for (let p = 1; p >= 0; p -= 0.05) {
    const y = bordaDaOnda(p, 'cobrir', H, amplitude(p, H));
    assert.ok(y <= antes + 1e-6, `cobrir desceu em ${p.toFixed(2)}`);
    antes = y;
  }
  antes = Infinity;
  for (let p = 0; p <= 1; p += 0.05) {
    const y = bordaDaOnda(p, 'revelar', H, amplitude(p, H));
    assert.ok(y <= antes + 1e-6, `revelar desceu em ${p.toFixed(2)}`);
    antes = y;
  }
});

test('a curva é mais funda no meio do caminho do que nas pontas', () => {
  assert.ok(amplitude(0.5, H) > amplitude(0, H));
  assert.ok(amplitude(0.5, H) > amplitude(1, H));
});

test('o círculo cobre a tela inteira a partir de qualquer origem', () => {
  for (const [width, height] of [[W, H], [1280, 800], [800, 1280]]) {
    for (const [ox, oy] of [[0.5, 0.8], [0, 0], [1, 1], [0.2, 0.5]]) {
      const r = raioDaCobertura(0, ox, oy, width, height);
      const cx = ox * width;
      const cy = oy * height;
      for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
        assert.ok(Math.hypot(x - cx, y - cy) <= r, `canto ${x},${y} fora do círculo de ${ox},${oy} em ${width}x${height}`);
      }
      assert.equal(raioDaCobertura(1, ox, oy, width, height), 0);
    }
  }
});

test('a curva de tempo vai de 0 a 1 sem sair do intervalo', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  for (let t = 0; t <= 1; t += 0.1) assert.ok(easeInOut(t) >= 0 && easeInOut(t) <= 1);
});

test('a capa para com a linha de base em 20% da altura', () => {
  for (const altura of [640, 874, 956, 800, 1280]) {
    const p = progressoDaCapa(altura);
    assert.ok(p > 0 && p < 1);
    const base = bordaDaOnda(p, 'revelar', altura, amplitude(p, altura));
    assert.ok(Math.abs(base - altura * CAPA) < 0.5, `H=${altura}: base ${base}`);
  }
});

test('a altura da capa é o ponto mais baixo da borda (o fundo da barriga)', () => {
  const p = progressoDaCapa(H);
  const A = amplitude(p, H);
  const c = pontosDaCurva(bordaDaOnda(p, 'revelar', H, A), W, A);
  // A cúbica de (0, y0) a (W, y1), amostrada fina.
  let fundo = -Infinity;
  for (let t = 0; t <= 1; t += 0.001) {
    const u = 1 - t;
    const y = u * u * u * c.y0 + 3 * u * u * t * c.c1y + 3 * u * t * t * c.c2y + t * t * t * c.y1;
    fundo = Math.max(fundo, y);
  }
  assert.ok(Math.abs(alturaDaCapa(H) - fundo) < 0.5, `${alturaDaCapa(H)} contra ${fundo}`);
  assert.ok(fundo > c.y0, 'a barriga desce abaixo da ponta esquerda');
});
