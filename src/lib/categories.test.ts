/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { INCOME_CATEGORIES, SUGGESTED_CATEGORIES } from './categories.ts';

/** Extrai a lista literal declarada em `export const SUGGESTED_CATEGORIES = [...]`. */
function parseListFrom(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const match = source.match(/export const SUGGESTED_CATEGORIES = \[([\s\S]*?)\]/);
  assert.ok(match, `não achei SUGGESTED_CATEGORIES em ${path}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

test('o prompt do Gemini usa exatamente as mesmas categorias do app', () => {
  // Duplicação inevitável (Deno não importa de src/) — este teste é a trava.
  const doPrompt = parseListFrom('supabase/functions/_shared/gemini.ts');
  assert.deepEqual(doPrompt, [...SUGGESTED_CATEGORIES]);
});

test('categorias são curtas, minúsculas e sem duplicata', () => {
  for (const cat of SUGGESTED_CATEGORIES) {
    assert.equal(cat, cat.toLowerCase(), `${cat} deveria ser minúscula`);
    assert.ok(cat.length <= 12, `${cat} é longa demais para um chip`);
  }
  assert.equal(new Set(SUGGESTED_CATEGORIES).size, SUGGESTED_CATEGORIES.length);
});

test('categorias de receita fazem parte da lista', () => {
  for (const cat of INCOME_CATEGORIES) {
    assert.ok(SUGGESTED_CATEGORIES.includes(cat), `${cat} sumiu da lista`);
  }
});
