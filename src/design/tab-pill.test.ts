import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEIO_PAR_MAIS_LARGO, VAO_ENTRE_ROTULOS, centroDoSlot, distanciaDaAba, escalaDoRotulo, folgaDaMola, larguraDoAlvo, posicaoDesenhada } from './tab-pill.ts';

// As medidas reais da barra: 384dp de tela, calha de 16, respiro interno de 6, cinco abas.
const PAD = 6;
const slot = (384 - 16 * 2 - PAD * 2) / 5;
const DIAMETRO = 36;

test('a folga deixa o círculo encostar no respiro da pílula, nunca passar dele', () => {
  const folga = folgaDaMola(slot, DIAMETRO, PAD);
  const naPonta = centroDoSlot(posicaoDesenhada(-5, 5, folga), slot);
  // A borda esquerda do círculo fica 1dp dentro da pílula (o respiro é -PAD a partir da origem).
  assert.ok(Math.abs(naPonta - DIAMETRO / 2 - (-PAD + 1)) < 1e-9);
  const noFim = centroDoSlot(posicaoDesenhada(99, 5, folga), slot);
  assert.ok(Math.abs(noFim + DIAMETRO / 2 - (5 * slot + PAD - 1)) < 1e-9);
});

test('dentro da faixa a posição da mola passa intacta', () => {
  assert.equal(posicaoDesenhada(2.3, 5, 0.2), 2.3);
  assert.equal(posicaoDesenhada(0, 5, 0.2), 0);
  assert.equal(posicaoDesenhada(-0.1, 5, 0.2), -0.1);
});

test('slot pequeno demais não dá folga negativa', () => {
  assert.equal(folgaDaMola(20, 36, 0), 0);
  assert.equal(folgaDaMola(0, 36, 6), 0);
});

test('a distância da aba satura em um slot', () => {
  assert.equal(distanciaDaAba(2, 2), 0);
  assert.equal(distanciaDaAba(2.25, 2), 0.25);
  assert.equal(distanciaDaAba(4, 2), 1);
  assert.equal(centroDoSlot(0, 64), 32);
});

test('o alvo ocupa o slot no celular, mas não a faixa vazia entre ícones no tablet', () => {
  assert.equal(larguraDoAlvo(slot), slot);
  assert.equal(larguraDoAlvo(247), 96);
  assert.equal(larguraDoAlvo(0), 0);
});

test('rótulos vizinhos nunca ficam a menos do vão mínimo, em nenhuma largura de celular', () => {
  // 28/09/2026: a 360dp com a fonte a 1,15× "Financeiro" encostava em "Agente".
  for (const tela of [320, 360, 384, 393, 411, 440]) {
    const s = (tela - 16 * 2 - PAD * 2) / 5;
    for (const fonte of [0.85, 1, 1.15, 1.3, 2]) {
      const vao = s - MEIO_PAR_MAIS_LARGO * escalaDoRotulo(s, fonte);
      assert.ok(vao >= VAO_ENTRE_ROTULOS - 1e-9 || escalaDoRotulo(s, fonte) === 0.8, `${tela}dp × ${fonte}: vão ${vao}`);
    }
  }
});

test('com espaço sobrando, o rótulo segue a fonte do sistema até 1,15×', () => {
  const largo = (440 - 16 * 2 - PAD * 2) / 5;
  assert.equal(escalaDoRotulo(largo, 1), 1);
  assert.equal(escalaDoRotulo(largo, 1.15), 1.15);
  assert.equal(escalaDoRotulo(largo, 1.3), 1.15);
  assert.ok(escalaDoRotulo((360 - 16 * 2 - PAD * 2) / 5, 1.15) < 1.15, 'a 360dp ela cede');
});
