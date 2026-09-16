import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrast } from './contrast.ts';

/**
 * O contraste da paleta, medido — não afirmado.
 *
 * Lê `constants/theme.ts` como TEXTO (ele importa `react-native` e não roda em `node --test`),
 * pela mesma estratégia do `anti-slop.test.ts`. Só pares hex opacos entram: um `rgba` depende do
 * que está por baixo e não tem contraste próprio.
 */
const theme = readFileSync(join(import.meta.dirname, '..', 'constants', 'theme.ts'), 'utf8');

function paleta(modo: 'light' | 'dark'): Record<string, string> {
  const inicio = theme.indexOf(`  ${modo}: {`, theme.indexOf('export const Colors'));
  const fim = theme.indexOf('\n  },', inicio);
  assert.ok(inicio > 0 && fim > inicio, `bloco ${modo} de Colors não encontrado`);
  const bloco = theme.slice(inicio, fim);
  return Object.fromEntries(
    [...bloco.matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]])
  );
}

/** [primeiro plano, fundo, mínimo]. 7 para texto de leitura; 4,5 (AA) para o resto. */
const PARES: [string, string, number][] = [
  ['text', 'background', 7],
  ['text', 'surface', 7],
  ['textSecondary', 'background', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['tint', 'background', 4.5],
  ['tint', 'surface', 4.5],
  ['onTint', 'tintFill', 4.5],
  ['danger', 'background', 4.5],
  ['success', 'background', 4.5],
  ['warning', 'background', 4.5],
  ['onHero', 'heroSurface', 7],
  ['onHeroDanger', 'heroSurface', 4.5],
  ['onHeroSuccess', 'heroSurface', 4.5],
  ['onHeroWarning', 'heroSurface', 4.5],
  ['tilePaper', 'tileInk', 7],
];

for (const modo of ['light', 'dark'] as const) {
  test(`contraste da paleta ${modo}`, () => {
    const p = paleta(modo);
    const falhas: string[] = [];
    for (const [frente, fundo, minimo] of PARES) {
      assert.ok(p[frente] && p[fundo], `${modo}: ${frente} ou ${fundo} ausente, ou não é hex opaco`);
      const c = contrast(p[frente], p[fundo]);
      if (c < minimo) falhas.push(`${frente} sobre ${fundo} = ${c.toFixed(2)} (mínimo ${minimo})`);
    }
    assert.deepEqual(falhas, []);
  });
}

test('os dois temas declaram os mesmos papéis de cor', () => {
  const chaves = (modo: 'light' | 'dark') => {
    const inicio = theme.indexOf(`  ${modo}: {`, theme.indexOf('export const Colors'));
    const bloco = theme.slice(inicio, theme.indexOf('\n  },', inicio));
    return [...bloco.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]).sort();
  };
  assert.deepEqual(chaves('light'), chaves('dark'));
});

test('contrast() confere com a referência WCAG', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF') * 100) / 100, 21);
  assert.equal(Math.round(contrast('#FFFFFF', '#000000') * 100) / 100, 21);
  assert.equal(Math.round(contrast('#777777', '#FFFFFF') * 100) / 100, 4.48);
});
