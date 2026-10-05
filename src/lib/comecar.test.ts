import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lerSalvo, passoEfetivo } from './comecar.ts';

const c = (id: string, type = 'checking') => ({ id, type });

test('sem progresso e sem contas, começa pelo passo 1', () => {
  assert.deepEqual(passoEfetivo(null, []), { passo: 1, contaIds: [], jaTinhaContas: false });
});

test('conta que existe encerra o passo 1, mesmo com o guardado em 1', () => {
  assert.equal(passoEfetivo({ passo: 1, contaIds: ['a'] }, [c('a')]).passo, 2);
});

test('retoma no passo guardado quando os ids ainda existem', () => {
  const e = passoEfetivo({ passo: 3, contaIds: ['a'], cartaoId: 'k' }, [c('a'), c('k', 'credit_card')]);
  assert.deepEqual(e, { passo: 3, contaIds: ['a'], cartaoId: 'k', jaTinhaContas: false });
});

test('id apagado sai da lista; cartão apagado some e o passo fica', () => {
  const e = passoEfetivo({ passo: 3, contaIds: ['a', 'x'], cartaoId: 'k' }, [c('a')]);
  assert.deepEqual(e.contaIds, ['a']);
  assert.equal(e.cartaoId, undefined);
  assert.equal(e.passo, 3);
});

test('conta criada apagada e nenhuma outra: volta ao passo 1', () => {
  assert.equal(passoEfetivo({ passo: 4, contaIds: ['a'] }, []).passo, 1);
});

test('contas de antes, sem progresso ou com o guardado apagado: resumo delas, sem o cartão', () => {
  const contas = [c('a'), c('k', 'credit_card')];
  for (const salvo of [null, { passo: 2 as const, contaIds: ['x'] }]) {
    assert.deepEqual(passoEfetivo(salvo, contas), { passo: 4, contaIds: ['a'], jaTinhaContas: true });
  }
});

test('lerSalvo recusa lixo e aceita o formato gravado', () => {
  assert.equal(lerSalvo('nao json'), null);
  assert.equal(lerSalvo('{"passo":9,"contaIds":[]}'), null);
  assert.deepEqual(lerSalvo('{"passo":2,"contaIds":["a",1],"cartaoId":"k"}'), { passo: 2, contaIds: ['a'], cartaoId: 'k' });
});
