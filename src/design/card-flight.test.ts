import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALFA_DA_TINTA_SUAVE,
  ALFA_DO_BRILHO,
  TINTA_CLARA,
  TINTA_ESCURA,
  blend,
  brandColor,
  clarear,
  escurecer,
  faceDoCartao,
  tintaDoCartao,
} from './card-brands.ts';
import { contrast } from './contrast.ts';
import { PROPORCAO_DO_CARTAO, alturaDoCartao, proporcaoDoCartao } from './card-geometry.ts';
import { alvoDoDeslize, comElastico, distanciaDoItem, indiceNoDeslocamento, quadroDoItem } from './carousel-math.ts';
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

test('a tinta da face segue o contraste: clara no roxo, escura no amarelo', () => {
  assert.equal(tintaDoCartao(brandColor('Ourocard BB')), 'escura');
  assert.equal(tintaDoCartao(brandColor('Nubank')), 'clara');
  assert.equal(tintaDoCartao(brandColor('Cartão da casa')), 'clara');
  assert.equal(clarear('#000000', 1), '#ffffff');
  assert.equal(escurecer('#ffffff', 1), '#000000');
});

// Os nomes que casam com cada entrada de `BRANDS`, mais o neutro. Um emissor novo no mapa entra
// aqui também — a face dele precisa passar pelo mesmo teste de leitura.
const EMISSORES = [
  'Nubank', 'Itaú', 'Inter', 'Bradesco', 'Santander', 'Caixa', 'Banco do Brasil', 'XP', 'C6',
  'BTG', 'Safra', 'Sicredi', 'Sicoob', 'Porto Seguro', 'Mercado Pago', 'PicPay', 'Neon',
  'Original', 'Pan', 'Will', 'Digio', 'Amex', 'Visa', 'Mastercard', 'Elo', 'Hipercard',
  'Cartão da casa',
];

test('todo emissor tem texto principal e secundário legíveis (≥ 4,5:1) em todo o metal', () => {
  const falhas: string[] = [];
  for (const nome of EMISSORES) {
    const face = faceDoCartao(brandColor(nome));
    const tinta = face.tinta === 'clara' ? TINTA_CLARA : TINTA_ESCURA;
    const brilho = blend('#FFFFFF', face.base, ALFA_DO_BRILHO);
    for (const fundo of [face.base, face.fim, brilho]) {
      const principal = contrast(tinta, fundo);
      const secundario = contrast(blend(tinta, fundo, ALFA_DA_TINTA_SUAVE), fundo);
      if (principal < 4.5 || secundario < 4.5)
        falhas.push(`${nome} ${fundo}: ${principal.toFixed(2)} / ${secundario.toFixed(2)}`);
    }
  }
  assert.deepEqual(falhas, []);
});

test('os tokens da face usam a mesma opacidade e o mesmo brilho que a conta de contraste', () => {
  const theme = readFileSync(join(import.meta.dirname, '..', 'constants', 'theme.ts'), 'utf8');
  const alfa = (token: string) =>
    [...theme.matchAll(new RegExp(`${token}: 'rgba\\([^)]*,\\s*([0-9.]+)\\)'`, 'g'))].map((m) => Number(m[1]));
  for (const token of ['onCardLightMuted', 'onCardInkMuted']) {
    assert.deepEqual(alfa(token), [ALFA_DA_TINTA_SUAVE, ALFA_DA_TINTA_SUAVE], token);
  }
  assert.deepEqual(alfa('cardSheen'), [ALFA_DO_BRILHO, ALFA_DO_BRILHO]);
});

test('o deslize anda no máximo um cartão e respeita a intenção do dedo', () => {
  const passo = 220;
  // arrastou pouco e devagar: volta para onde estava
  assert.equal(alvoDoDeslize(220, 250, 0, passo, 3), 1);
  // arrastou pouco, mas rápido: vai para o próximo
  assert.equal(alvoDoDeslize(220, 250, 1200, passo, 3), 2);
  // um peteleco fortíssimo não pula dois cartões
  assert.equal(alvoDoDeslize(0, 200, 9000, passo, 5), 1);
  // rápido para trás a partir do meio
  assert.equal(alvoDoDeslize(440, 400, -1500, passo, 5), 1);
  // presos nas pontas
  assert.equal(alvoDoDeslize(0, -60, -3000, passo, 3), 0);
  assert.equal(alvoDoDeslize(440, 500, 3000, passo, 3), 2);
  assert.equal(alvoDoDeslize(0, 0, 0, 0, 3), 0);
});

test('além das pontas o carrossel cede um terço do dedo', () => {
  assert.equal(comElastico(-90, 220, 3), -90 * 0.35);
  assert.equal(comElastico(300, 220, 3), 300);
  assert.equal(comElastico(440 + 60, 220, 3), 440 + 60 * 0.35);
});
