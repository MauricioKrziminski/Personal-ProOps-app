/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterCategories, foldCategory, mergeCategories } from './categories-merge.ts';

/** Os números são os de produção em 09/09/2026. */
const USADAS = [
  { category: 'outros', uses: 32 },
  { category: 'assinaturas', uses: 31 },
  { category: 'despesas eventuais', uses: 14 },
  { category: 'roupa', uses: 10 },
  { category: 'salario', uses: 7 },
  { category: 'salário', uses: 6 },
  { category: 'saúde', uses: 3 },
  { category: 'saude', uses: 1 },
];
const SUGERIDAS = ['mercado', 'transporte', 'salário', 'saúde', 'outros'];

test('o que o usuário usa aparece — era o defeito', () => {
  const labels = mergeCategories(USADAS, SUGERIDAS).map((o) => o.label);
  for (const c of ['despesas eventuais', 'roupa']) {
    assert.ok(labels.includes(c), `${c} tem lançamentos e não estava no seletor`);
  }
});

test('acento e caixa não viram duas entradas', () => {
  const opcoes = mergeCategories(USADAS, SUGERIDAS);
  assert.equal(opcoes.filter((o) => foldCategory(o.label) === 'salario').length, 1);
  assert.equal(opcoes.filter((o) => foldCategory(o.label) === 'saude').length, 1);
});

test('a contagem é a soma das duas grafias', () => {
  const salario = mergeCategories(USADAS, SUGERIDAS).find((o) => foldCategory(o.label) === 'salario');
  assert.equal(salario?.uses, 13, 'as duas grafias são a mesma categoria');
});

test('a grafia da SUGESTÃO ganha da contagem — o erro de digitação não vira o chip principal', () => {
  const salario = mergeCategories(USADAS, SUGERIDAS).find((o) => foldCategory(o.label) === 'salario');
  // `salario` tem 7 usos e `salário` 6: pela contagem o typo venceria, e cada escolha nova
  // pelo seletor aumentaria o 7 — o app afundaria a forma correta sozinho.
  assert.equal(salario?.label, 'salário');
});

test('sem sugestão para arbitrar, vence a mais usada', () => {
  const [pet] = mergeCategories(
    [{ category: 'Pet', uses: 5 }, { category: 'pet', uses: 2 }], [],
  );
  assert.equal(pet.label, 'Pet');
});

test('empate vai para a forma acentuada', () => {
  const [saude] = mergeCategories([{ category: 'saude', uses: 2 }, { category: 'saúde', uses: 2 }], []);
  assert.equal(saude.label, 'saúde');
});

test('sugestão nunca usada continua oferecida, mas atrás', () => {
  const opcoes = mergeCategories(USADAS, SUGERIDAS);
  const labels = opcoes.map((o) => o.label);
  assert.ok(labels.includes('mercado'));
  assert.ok(
    labels.indexOf('outros') < labels.indexOf('mercado'),
    'o que ele usa vem antes do que o app supõe',
  );
});

test('a categoria do lançamento aberto não some da lista', () => {
  const labels = mergeCategories([], SUGERIDAS, 'pet').map((o) => o.label);
  assert.ok(labels.includes('pet'), 'editar um lançamento não pode esconder a categoria dele');
});

test('busca ignora acento — quem digita "saude" acha "saúde"', () => {
  const achou = filterCategories(mergeCategories(USADAS, SUGERIDAS), 'saude');
  assert.ok(achou.some((o) => foldCategory(o.label) === 'saude'));
  assert.equal(filterCategories(mergeCategories(USADAS, SUGERIDAS), '').length,
               mergeCategories(USADAS, SUGERIDAS).length, 'busca vazia não filtra');
});
