import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  posX,
  posY,
  reordenar,
  slotDoIrmao,
  slotSobODedo,
  velocidadeAutoScroll,
} from './reorder-math.ts';

/**
 * Off-by-one aqui não dá erro nenhum: o cartão simplesmente pousa no lugar errado, e quem
 * descobre é o usuário, três arrastadas depois, com a lista em outra ordem.
 */

const IDS = ['a', 'b', 'c', 'd'];
/** Alturas propositalmente DESIGUAIS: é o caso que a lista tem e a grade não. */
const H = { a: 100, b: 40, c: 80, d: 40 };
const GAP = 8;

/* ── lista (1 coluna, altura medida) ───────────────────────────────────────── */

test('a posição soma as alturas medidas mais o respiro', () => {
  assert.equal(posY(0, IDS, H, 0, GAP, 1), 0);
  assert.equal(posY(1, IDS, H, 0, GAP, 1), 108);
  assert.equal(posY(2, IDS, H, 0, GAP, 1), 156);
  assert.equal(posX(3, 0, GAP, 1), 0, 'numa lista não há coluna');
});

test('altura ainda não medida conta zero e não estoura', () => {
  assert.equal(posY(2, IDS, { a: 100 }, 0, GAP, 1), 116);
});

test('o slot sai do CENTRO do item arrastado, não do topo', () => {
  // "a" (100 de altura) sendo arrastado 60px para baixo: o topo ainda está dentro do slot 0,
  // mas o CENTRO já passou de "b". Com o critério do topo o leque piscaria no meio do caminho.
  assert.equal(slotSobODedo(0, 4, 0, 60, IDS, H, 0, 0, GAP, 1), 1);
  assert.equal(slotSobODedo(0, 4, 0, 0, IDS, H, 0, 0, GAP, 1), 0);
});

test('arrastar para fora das pontas gruda na primeira e na última', () => {
  assert.equal(slotSobODedo(2, 4, 0, -500, IDS, H, 0, 0, GAP, 1), 0);
  assert.equal(slotSobODedo(1, 4, 0, 5000, IDS, H, 0, 0, GAP, 1), 3);
});

/* ── grade (N colunas, ladrilho uniforme) ──────────────────────────────────── */

test('a grade é aritmética exata: índice vira linha e coluna', () => {
  const L = 100, T = 120;
  assert.deepEqual([posX(0, L, GAP, 3), posY(0, [], {}, T, GAP, 3)], [0, 0]);
  assert.deepEqual([posX(2, L, GAP, 3), posY(2, [], {}, T, GAP, 3)], [216, 0]);
  assert.deepEqual([posX(3, L, GAP, 3), posY(3, [], {}, T, GAP, 3)], [0, 128]);
  assert.deepEqual([posX(4, L, GAP, 3), posY(4, [], {}, T, GAP, 3)], [108, 128]);
});

test('na grade o slot é o ladrilho mais próximo, preso dentro dos dados', () => {
  const L = 100, T = 120;
  assert.equal(slotSobODedo(0, 6, 108, 128, [], {}, T, L, GAP, 3), 4);
  assert.equal(slotSobODedo(0, 6, 900, 900, [], {}, T, L, GAP, 3), 5, 'não passa do último');
  assert.equal(slotSobODedo(5, 6, -90, -90, [], {}, T, L, GAP, 3), 0, 'nem antes do primeiro');
});

/* ── quem anda e quanto ────────────────────────────────────────────────────── */

test('só o irmão ENTRE a origem e o destino anda, e anda UM slot', () => {
  // arrastando 0 → 2: os slots 1 e 2 sobem um; 3 fica parado.
  assert.equal(slotDoIrmao(1, 0, 2), 0);
  assert.equal(slotDoIrmao(2, 0, 2), 1);
  assert.equal(slotDoIrmao(3, 0, 2), 3);
  // arrastando 3 → 1: os slots 1 e 2 descem um; 0 fica parado.
  assert.equal(slotDoIrmao(1, 3, 1), 2);
  assert.equal(slotDoIrmao(2, 3, 1), 3);
  assert.equal(slotDoIrmao(0, 3, 1), 0);
});

test('sem arrasto em curso ninguém se mexe', () => {
  assert.equal(slotDoIrmao(2, -1, -1), 2);
});

test('o item arrastado acaba exatamente no slot que o leque abriu', () => {
  // A prova de coerência entre as duas metades: para todo par (de, para), a ordem final põe o
  // item em `para`, e todo irmão fica onde `slotDoIrmao` prometeu.
  for (let de = 0; de < IDS.length; de++) {
    for (let para = 0; para < IDS.length; para++) {
      const nova = reordenar(IDS, de, para);
      assert.equal(nova[para], IDS[de], `${de}→${para}: o arrastado não pousou no alvo`);
      for (let i = 0; i < IDS.length; i++) {
        if (i === de) continue;
        assert.equal(
          nova[slotDoIrmao(i, de, para)],
          IDS[i],
          `${de}→${para}: o irmão ${i} foi animado para um slot que não é o dele`
        );
      }
    }
  }
});

/*
  Auto-scroll — os números são os MEDIDOS no emulador em 14/09/2026, com 20 pastas:
  scroll de 888dp de altura, ladrilho de 114, faixa de 88, dock de 98.
*/
const JANELA = 888;
const DOCK = 98;
const BORDA = 88;
const VEL = 10;
const LADRILHO = 114;

test('no meio da tela o auto-scroll fica parado', () => {
  assert.equal(velocidadeAutoScroll(400, LADRILHO, JANELA, DOCK, BORDA, VEL), 0);
});

test('perto do topo ele sobe, e mais rápido quanto mais perto', () => {
  const meio = velocidadeAutoScroll(44, LADRILHO, JANELA, DOCK, BORDA, VEL);
  const quase = velocidadeAutoScroll(4, LADRILHO, JANELA, DOCK, BORDA, VEL);
  assert.ok(meio < 0 && quase < 0);
  assert.ok(quase < meio, 'mais perto da borda tem que puxar mais forte');
});

test('o pé da faixa desconta a DOCK — senão o dedo nunca alcança', () => {
  // 663 é o TOPO do ladrilho no ponto mais fundo que o dedo alcançou no aparelho (a base fica
  // em 777): abaixo disso é a área de gesto do sistema, e o `MOVE` nem chega ao app.
  const alcancavel = 663;
  assert.ok(
    velocidadeAutoScroll(alcancavel, LADRILHO, JANELA, DOCK, BORDA, VEL) > 0,
    'com a dock descontada o ponto alcançável tem que rolar'
  );
  assert.equal(
    velocidadeAutoScroll(alcancavel, LADRILHO, JANELA, 0, BORDA, VEL),
    0,
    'sem descontar a dock a faixa fica fora do alcance — era este o bug'
  );
});
