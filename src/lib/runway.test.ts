import assert from 'node:assert/strict';
import { test } from 'node:test';

import { degrausDaPista, entalheMaisProximo, montarPista } from './runway.ts';

test('com a soma batendo, os entalhes descem até o número do herói', () => {
  const p = montarPista(
    100000,
    60000,
    [
      { day: '2026-09-17', out_cents: 10000 },
      { day: '2026-09-20', out_cents: 30000 },
      { day: '2026-09-20', out_cents: '20000' },
    ],
    '2026-09-17',
    '2026-09-27'
  );
  assert.equal(p.confere, true);
  assert.equal(p.livre, 40000);
  assert.deepEqual(p.entalhes.map((e) => e.day), ['2026-09-17', '2026-09-20']);
  assert.equal(p.entalhes[0].posicao, 0);
  assert.equal(p.entalhes[1].posicao, 0.3);
  assert.equal(p.entalhes[1].saida, 50000);
  assert.equal(p.entalhes.at(-1)!.livreDepois, p.livre);
});

test('soma que não bate não desenha entalhe nenhum — nunca contradiz o herói', () => {
  const p = montarPista(100000, 60000, [{ day: '2026-09-20', out_cents: 10000 }], '2026-09-17', '2026-09-27');
  assert.equal(p.confere, false);
  assert.deepEqual(p.entalhes, []);
  assert.equal(p.livre, 40000);
});

test('sem eventos não há o que conferir', () => {
  const p = montarPista(100000, 0, [], '2026-09-17', '2026-09-27');
  assert.equal(p.confere, false);
  assert.deepEqual(p.entalhes, []);
});

test('evento além da ponta fica preso na ponta', () => {
  const p = montarPista(0, 500, [{ day: '2026-10-30', out_cents: 500 }], '2026-09-17', '2026-09-27');
  assert.equal(p.entalhes[0].posicao, 1);
});

test('entalhe mais próximo do dedo', () => {
  assert.equal(entalheMaisProximo([], 0.5), -1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.5), 1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.7), 2);
});

test('os degraus descem a cada saída, partindo do caixa inteiro', () => {
  const p = montarPista(
    100000,
    60000,
    [
      { day: '2026-09-20', out_cents: 20000 },
      { day: '2026-09-24', out_cents: 40000 },
    ],
    '2026-09-17',
    '2026-09-27'
  );
  const d = degrausDaPista(p);
  assert.deepEqual(
    d.map((x) => [x.inicio, x.fim, x.fracao]),
    [
      [0, 0.3, 1],
      [0.3, 0.7, 0.8],
      [0.7, 1, 0.4],
    ]
  );
  assert.equal(d[1].entalhe, 0);
  assert.equal(d[0].entalhe, -1);
});

test('saída hoje não cria degrau de largura zero', () => {
  const p = montarPista(100000, 30000, [{ day: '2026-09-17', out_cents: 30000 }], '2026-09-17', '2026-09-27');
  const d = degrausDaPista(p);
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].inicio, d[0].fim, d[0].fracao], [0, 1, 0.7]);
});

test('sem entalhes a pista é um degrau só, na altura do livre; negativo não sobe', () => {
  const p = montarPista(100000, 25000, [], '2026-09-17', '2026-09-27');
  assert.deepEqual(degrausDaPista(p).map((x) => x.fracao), [0.75]);
  const negativo = montarPista(10000, 30000, [], '2026-09-17', '2026-09-27');
  const [n] = degrausDaPista(negativo);
  assert.equal(n.fracao, 0);
  assert.equal(n.negativo, true);
});
