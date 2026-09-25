import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrast } from './contrast.ts';
import { superficieDaNota } from './note-surface.ts';

/**
 * A cor da nota pinta o cartão INTEIRO (25/09/2026, decisão do dono do produto: *"o card inteiro
 * tem que ficar daquela cor e não somente um detalhe quase imperceptível"*). O risco é o texto:
 * o cinza secundário sobre um fundo tingido cai abaixo de 4,5:1 em metade das cores. Medido aqui,
 * nas oito cores e nos dois temas — `theme.ts` é lido como TEXTO, como no `contrast.test.ts`.
 */
const theme = readFileSync(join(import.meta.dirname, '..', 'constants', 'theme.ts'), 'utf8');

function bloco(de: string, modo: 'light' | 'dark'): Record<string, string> {
  const inicio = theme.indexOf(`  ${modo}: {`, theme.indexOf(de));
  const fim = theme.indexOf('\n  },', inicio);
  assert.ok(inicio > 0 && fim > inicio, `bloco ${modo} de ${de} não encontrado`);
  return Object.fromEntries(
    [...theme.slice(inicio, fim).matchAll(/(\w+): '(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]])
  );
}

for (const modo of ['light', 'dark'] as const) {
  const cores = bloco('export const Colors', modo);
  const notas = bloco('export const NoteColors', modo);

  test(`${modo}: as oito cores pintam o cartão e o texto continua legível`, () => {
    assert.equal(Object.keys(notas).length, 8);
    for (const [nome, tinta] of Object.entries(notas)) {
      const s = superficieDaNota(tinta, modo, { surface: cores.surface, text: cores.text });
      // O cartão É daquela cor: longe o bastante da superfície comum para se ver a um metro.
      assert.ok(contrast(s.fundo, cores.surface) >= 1.2, `${nome}: ${s.fundo} quase igual à superfície`);
      assert.ok(contrast(cores.text, s.fundo) >= 7, `${nome}: título sobre ${s.fundo}`);
      assert.ok(contrast(s.secundario, s.fundo) >= 4.5, `${nome}: secundário ${s.secundario} sobre ${s.fundo}`);
      // O tom forte (tocado, arrastado, pílula da pasta) também carrega texto.
      assert.ok(contrast(cores.text, s.forte) >= 4.5, `${nome}: texto sobre ${s.forte}`);
      assert.notEqual(s.forte, s.fundo);
    }
  });
}
