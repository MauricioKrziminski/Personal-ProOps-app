import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { aparenciaDaCategoria, ICONES_DE_CATEGORIA, nomeDaCategoria, ROTULO_DO_ICONE, type Categoria } from './categorias.ts';

const cats: Categoria[] = [
  { category: 'mercado', uses: 9, icon: 'cart', color: 'musgo', budgets: 1 },
  { category: 'lazer', uses: 3, icon: null, color: null, budgets: 0 },
];

test('a linha da tabela manda; sem ela, o ícone adivinhado pelo nome e sem cor', () => {
  assert.deepEqual(aparenciaDaCategoria('Mercado', cats), { icon: 'cart', cor: 'musgo' }, 'caixa não importa');
  assert.deepEqual(aparenciaDaCategoria(' mércado ', cats), { icon: 'cart', cor: 'musgo' }, 'acento e espaço não importam');
  assert.deepEqual(aparenciaDaCategoria('lazer', cats), { icon: 'sparkles', cor: null }, 'linha sem ícone cai no adivinhado');
  assert.deepEqual(aparenciaDaCategoria(null, cats, 'income'), { icon: 'arrow.down.left', cor: null });
  assert.deepEqual(aparenciaDaCategoria('xyz', cats), { icon: 'tag', cor: null });
});

test('o nome gravado é minúsculo e sem espaço nas pontas (o CHECK do banco)', () => {
  assert.equal(nomeDaCategoria('  Viagem '), 'viagem');
});

test('todo ícone da grade existe no Android (MATERIAL) e tem nome para o leitor de tela', () => {
  const fonte = readFileSync('src/components/ui/icon.tsx', 'utf8');
  // as chaves do MATERIAL vêm com aspas quando têm ponto ('cup.and.saucer') e sem quando não têm (airplane)
  for (const i of ICONES_DE_CATEGORIA) {
    assert.match(fonte, new RegExp(`^\\s*'?${String(i).replace(/\./g, '\\.')}'?:`, 'm'), String(i));
    assert.ok(ROTULO_DO_ICONE[String(i)], `rótulo de ${String(i)}`);
  }
  assert.ok(ICONES_DE_CATEGORIA.length >= 24 && ICONES_DE_CATEGORIA.length <= 36);
  assert.equal(new Set(ICONES_DE_CATEGORIA).size, ICONES_DE_CATEGORIA.length);
});
