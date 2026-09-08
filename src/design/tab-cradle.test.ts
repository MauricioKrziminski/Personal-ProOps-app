import assert from 'node:assert/strict';
import { test } from 'node:test';

import { empurraoDaPonta, posicaoDoBerco } from './tab-cradle.ts';

/** As constantes reais da `CurvedTabBar`, para o teste medir o desenho que existe. */
const CUT = 52 / 2 + 7; // BUBBLE/2 + GAP = 33
const RAIO = 64 / 2; // BAR_H/2 = 32
const ABAS = 5;
const CALHA = 16; // Space.lg, de cada lado

const slotEm = (larguraDaTela: number) => (larguraDaTela - CALHA * 2) / ABAS;

test('a 384dp sobra uma lasca de 2,2dp e ela é empurrada', () => {
  const slot = slotEm(384);
  assert.equal(Math.round(slot * 10) / 10, 70.4);

  const empurrao = empurraoDaPonta(slot, CUT, RAIO);
  assert.equal(Math.round(empurrao * 10) / 10, 2.2);
});

test('numa tela larga a sobra É o canto arredondado, e nada se move', () => {
  // Tablet: o slot dobra, sobram 27dp depois do disco. Empurrar aqui tiraria a bolha de cima do
  // rótulo dela por 27dp — que é exatamente o defeito que a barra já teve uma vez.
  const empurrao = empurraoDaPonta(slotEm(800), CUT, RAIO);
  assert.equal(empurrao, 0);
});

test('quando o disco já passa da ponta não há o que corrigir', () => {
  // Tela estreita: o slot fica menor que o diâmetro do disco, então ele sai pela borda sozinho.
  const empurrao = empurraoDaPonta(slotEm(320), CUT, RAIO);
  assert.equal(empurrao, 0);
});

test('as larguras reais de celular caem dos dois lados do limiar, e isso é declarado', () => {
  // O limiar é r/4 = 8dp. Abaixo dele a sobra é lasca; acima, é canto.
  const medidas = [384, 393, 412, 448].map((w) => ({
    w,
    lasca: Math.round((slotEm(w) / 2 - CUT) * 10) / 10,
    empurrao: Math.round(empurraoDaPonta(slotEm(w), CUT, RAIO) * 10) / 10,
  }));

  assert.deepEqual(medidas, [
    { w: 384, lasca: 2.2, empurrao: 2.2 },
    { w: 393, lasca: 3.1, empurrao: 3.1 },
    { w: 412, lasca: 5, empurrao: 5 },
    // 448dp é o emulador padrão — 8,6dp de sobra, acima do limiar: aqui a ponta já lê como canto
    // e o berço fica onde está. É por isso que o defeito nunca apareceu no emulador e apareceu
    // no aparelho.
    { w: 448, lasca: 8.6, empurrao: 0 },
  ]);
});

test('o empurrão vale inteiro na ponta, some na aba vizinha e não salta no meio', () => {
  const slot = slotEm(384);
  const e = empurraoDaPonta(slot, CUT, RAIO);
  const emSlots = e / slot;

  // Primeira aba: puxada para a esquerda pelo empurrão inteiro.
  assert.equal(posicaoDoBerco(0, ABAS, e, slot), -emSlots);
  // Última: puxada para a direita.
  assert.equal(posicaoDoBerco(4, ABAS, e, slot), 4 + emSlots);
  // Miolo: intocado.
  assert.equal(posicaoDoBerco(2, ABAS, e, slot), 2);

  // Continuidade: passo a passo entre a aba 0 e a 1, a correção só diminui — nada de degrau.
  let anterior = Infinity;
  for (let p = 0; p <= 1.0001; p += 0.1) {
    const correcao = p - posicaoDoBerco(p, ABAS, e, slot);
    assert.ok(correcao <= anterior + 1e-9, `saltou em p=${p}`);
    anterior = correcao;
  }
  assert.ok(Math.abs(posicaoDoBerco(1, ABAS, e, slot) - 1) < 1e-9);
});

test('sem empurrão a posição passa intacta — inclusive a ultrapassagem da mola', () => {
  assert.equal(posicaoDoBerco(-0.12, ABAS, 0, 70.4), -0.12);
  assert.equal(posicaoDoBerco(4.12, ABAS, 0, 70.4), 4.12);
});
