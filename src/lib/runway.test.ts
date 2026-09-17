import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entalheMaisProximo, fracaoComprometida, montarPista } from './runway.ts';

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

test('fração comprometida', () => {
  const base = { entalhes: [], confere: false, livre: 0 };
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 0 }), 0);
  assert.equal(fracaoComprometida({ ...base, caixa: 0, comprometido: 10 }), 1);
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 25 }), 0.25);
  assert.equal(fracaoComprometida({ ...base, caixa: 100, comprometido: 300 }), 1);
});

test('entalhe mais próximo do dedo', () => {
  assert.equal(entalheMaisProximo([], 0.5), -1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.5), 1);
  assert.equal(entalheMaisProximo([0, 0.3, 0.9], 0.7), 2);
});
