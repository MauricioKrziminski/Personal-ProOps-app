import assert from 'node:assert/strict';
import { test } from 'node:test';

import { brandColor, clarear, escurecer, tintaDoCartao } from './card-brands.ts';
import { PROPORCAO_DO_CARTAO, alturaDoCartao, proporcaoDoCartao } from './card-geometry.ts';
import { distanciaDoItem, indiceNoDeslocamento, quadroDoItem } from './carousel-math.ts';
import { caixaArrastada, quadroDaCaixa, quadroNoVoo } from './flight-math.ts';

const pilha = { x: 16, y: 500, largura: 358, altura: 226 };
const vitrine = { x: 100, y: 180, largura: 201, altura: 319 };

test('o quadro de uma caixa em pé usa a ALTURA como lado longo e gira 90°', () => {
  assert.deepEqual(quadroDaCaixa(pilha, 'deitado'), { cx: 195, cy: 613, lado: 358, giro: 0 });
  assert.deepEqual(quadroDaCaixa(vitrine, 'em-pe'), { cx: 200.5, cy: 339.5, lado: 319, giro: 90 });
});

test('o voo começa na origem, termina no pouso e só levanta no meio', () => {
  const de = quadroDaCaixa(pilha, 'deitado');
  const para = quadroDaCaixa(vitrine, 'em-pe');
  assert.deepEqual(quadroNoVoo(0, de, para), de);
  const fim = quadroNoVoo(1, de, para);
  assert.equal(fim.cx, para.cx);
  assert.equal(fim.giro, 90);
  assert.ok(Math.abs(fim.cy - para.cy) < 1e-9);
  assert.ok(Math.abs(fim.lado - para.lado) < 1e-9);
  const meio = quadroNoVoo(0.5, de, para);
  assert.ok(meio.cy < (de.cy + para.cy) / 2, 'sobe no meio do caminho');
  assert.ok(meio.lado > (de.lado + para.lado) / 2, 'cresce no meio do caminho');
  assert.equal(meio.giro, 45);
});

test('o quique da mola não traz o arco de volta', () => {
  const de = quadroDaCaixa(pilha, 'deitado');
  const para = quadroDaCaixa(vitrine, 'em-pe');
  const passou = quadroNoVoo(1.02, de, para);
  assert.ok(Math.abs(passou.lado - (de.lado + (para.lado - de.lado) * 1.02)) < 1e-9);
});

test('a caixa arrastada desce e encolhe em volta do centro', () => {
  const c = caixaArrastada(vitrine, 40, 0.8);
  assert.equal(c.largura, vitrine.largura * 0.8);
  assert.equal(c.x + c.largura / 2, vitrine.x + vitrine.largura / 2);
  assert.equal(c.y + c.altura / 2, vitrine.y + vitrine.altura / 2 + 40);
});

test('o índice arredonda e fica preso nas pontas', () => {
  assert.equal(indiceNoDeslocamento(0, 220, 3), 0);
  assert.equal(indiceNoDeslocamento(109, 220, 3), 0);
  assert.equal(indiceNoDeslocamento(111, 220, 3), 1);
  assert.equal(indiceNoDeslocamento(9999, 220, 3), 2);
  assert.equal(indiceNoDeslocamento(-50, 220, 3), 0);
  assert.equal(indiceNoDeslocamento(100, 0, 3), 0);
  assert.equal(indiceNoDeslocamento(100, 220, 0), 0);
  assert.equal(distanciaDoItem(330, 220, 1), 0.5);
});

test('item no centro é identidade; vizinho em repouso é plano, menor e apagado', () => {
  assert.deepEqual(quadroDoItem(0, false), { giroY: 0, escala: 1, opacidade: 1 });
  for (const d of [1, -1, 3]) {
    const q = quadroDoItem(d, false);
    assert.equal(q.giroY, 0);
    assert.ok(Math.abs(q.escala - 0.86) < 1e-9);
    assert.ok(Math.abs(q.opacidade - 0.6) < 1e-9);
  }
  assert.equal(quadroDoItem(0.5, false).giroY, 50);
  assert.equal(quadroDoItem(-0.5, false).giroY, -50);
  assert.equal(quadroDoItem(0.5, true).giroY, 0);
});

test('a proporção cai com a fonte e nunca passa a do cartão de verdade', () => {
  assert.equal(proporcaoDoCartao(1), PROPORCAO_DO_CARTAO);
  assert.equal(proporcaoDoCartao(0.85), PROPORCAO_DO_CARTAO);
  assert.ok(proporcaoDoCartao(1.3) < PROPORCAO_DO_CARTAO);
  assert.ok(alturaDoCartao(358, 1.3) > alturaDoCartao(358, 1));
});

test('a tinta da face é a de maior contraste com a cor do emissor', () => {
  assert.equal(tintaDoCartao(brandColor('Ourocard BB')), 'escura');
  assert.equal(tintaDoCartao(brandColor('Nubank')), 'clara');
  assert.equal(tintaDoCartao(brandColor('Cartão da casa')), 'clara');
  assert.equal(clarear('#000000', 1), '#ffffff');
  assert.equal(escurecer('#ffffff', 1), '#000000');
});
