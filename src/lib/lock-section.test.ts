/**
 * Repõe a cobertura que o guarda `'Segmented não passa de 4 opções'` perde.
 *
 * Aquele guarda lê o JSX e conta `{ value:` dentro de `<Segmented ... />`. As opções do bloqueio
 * moram em constantes FORA do JSX (o ternário inline produzia um falso positivo de 5), então o
 * guarda não as enxerga — e uma regra que ninguém mede volta a subir sozinha, que é a lição do
 * `icon-map.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(
  new URL('../components/profile/lock-section.tsx', import.meta.url),
  'utf8'
);

function opcoes(nome: string): number {
  const m = src.match(new RegExp(`export const ${nome} = \\[([\\s\\S]*?)\\] as const;`));
  assert.ok(m, `${nome} não encontrada — o formato mudou`);
  return [...m[1].matchAll(/\{\s*value:/g)].length;
}

test('nenhum conjunto de opções do bloqueio passa de 4 — a régua do Segmented', () => {
  // A partir de 5 a célula fica estreita demais e o rótulo parte no meio da palavra a 384dp.
  for (const nome of ['MODOS_COM_BIOMETRIA', 'MODOS_SEM_BIOMETRIA', 'ESPERAS']) {
    const n = opcoes(nome);
    assert.ok(n >= 2, `${nome} tem ${n} opções — Segmented precisa de pelo menos 2`);
    assert.ok(n <= 4, `${nome} tem ${n} opções — acima de 4 use SelectField`);
  }
});

test('o modo desligado existe e é a primeira opção dos dois conjuntos', () => {
  // `off` é o padrão e o comportamento de hoje: ele não pode sumir por descuido.
  for (const nome of ['MODOS_COM_BIOMETRIA', 'MODOS_SEM_BIOMETRIA']) {
    const m = src.match(new RegExp(`export const ${nome} = \\[\\s*\\{\\s*value: '(\\w+)'`));
    assert.equal(m?.[1], 'off', `${nome} não começa em 'off'`);
  }
});
