import assert from 'node:assert/strict';
import { test } from 'node:test';

import { caminhoDaPasta, destinosDePasta, folderTree, mensagemDoErroDePasta, nomeRepetidoEntreIrmas } from './pastas.ts';

const p = (id: string, name: string, parent_id: string | null = null) => ({ id, name, parent_id });
const lista = [p('t', 'trabalho'), p('a', '2026', 't'), p('b', 'q1', 'a'), p('c', 'casa'), p('d', '2026', 'c')];

test('caminhoDaPasta escreve da raiz até a pasta e distingue nomes iguais', () => {
  assert.equal(caminhoDaPasta(lista, 'b'), 'trabalho / 2026 / q1');
  assert.equal(caminhoDaPasta(lista, 'd'), 'casa / 2026');
  assert.equal(caminhoDaPasta(lista, 'nada'), '');
  assert.equal(caminhoDaPasta([p('x', 'a', 'y'), p('y', 'b', 'x')], 'x'), 'b / a', 'ciclo não trava');
});

test('folderTree põe as filhas logo abaixo da mãe', () => {
  assert.deepEqual(folderTree(lista).map((f) => `${f.depth}:${f.id}`), ['0:t', '1:a', '2:b', '0:c', '1:d']);
});

test('destinosDePasta: mover exclui a própria pasta e as descendentes', () => {
  assert.deepEqual(destinosDePasta(lista, { id: 'a' }).map((f) => f.id), ['t', 'c', 'd']);
  assert.deepEqual(destinosDePasta(lista).map((f) => f.caminho), ['trabalho', 'trabalho / 2026', 'trabalho / 2026 / q1', 'casa', 'casa / 2026']);
});

test('destinosDePasta: não oferece o que estouraria o 5º nível', () => {
  const fundo = [p('1', 'a'), p('2', 'b', '1'), p('3', 'c', '2'), p('4', 'd', '3'), p('5', 'e', '4'), p('r', 'raiz')];
  assert.ok(!destinosDePasta(fundo).some((f) => f.id === '5'), 'criar dentro do 5º nível estoura');
  assert.ok(destinosDePasta(fundo).some((f) => f.id === '4'));
  // 'r' tem 1 nível abaixo (r -> s): só cabe até o nível 3 como mãe.
  const comFilha = [...fundo, p('s', 's', 'r')];
  const ids = destinosDePasta(comFilha, { id: 'r' }).map((f) => f.id);
  assert.ok(ids.includes('3') && !ids.includes('4') && !ids.includes('5'));
});

test('nomeRepetidoEntreIrmas só compara a mesma mãe', () => {
  assert.equal(nomeRepetidoEntreIrmas(lista, '2026', 't'), true);
  assert.equal(nomeRepetidoEntreIrmas(lista, '2026', null), false);
  assert.equal(nomeRepetidoEntreIrmas(lista, '2026', 't', 'a'), false, 'a própria pasta não conta');
});

test('mensagemDoErroDePasta usa a frase do banco ou a de nome repetido', () => {
  assert.equal(mensagemDoErroDePasta({ code: 'P0001', message: 'Pasta demais.' }, 'x'), 'Pasta demais.');
  assert.equal(mensagemDoErroDePasta({ code: '23505' }, 'x'), 'Já existe uma pasta com esse nome aqui.');
  assert.equal(mensagemDoErroDePasta(new Error('rede'), 'x'), 'x');
});
