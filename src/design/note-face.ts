/**
 * Marcas inline → qual FACE de fonte, como CHAVE de `Fonts`.
 *
 * Devolve a chave e não o valor de propósito: assim este arquivo não importa `constants/theme.ts`
 * (que puxa `react-native` e `global.css`) e a matriz — que é o que erra — fica testável em
 * `node --test`, como o resto dos helpers puros do projeto.
 *
 * ⚠️ **Peso é FAMÍLIA, nunca `fontWeight`** (§3 do design): fonte custom no Android ignora
 * `fontWeight` e cai no regular com negrito sintético, e `fontStyle: 'italic'` no iOS inclina a
 * letra por transformação enquanto o Android troca pela itálica do SISTEMA.
 */

import type { Mark } from '@/lib/note-inline';

export type FaceKey =
  | 'regular' | 'italic' | 'medium'
  | 'semibold' | 'semiboldItalic'
  | 'bold' | 'boldItalic'
  | 'mono';

/**
 * `base` é o peso do BLOCO (400 num parágrafo, 600 num título): negrito dentro de um título que
 * já é semibold precisa subir para 700, senão o `*negrito*` não faz nada visível ali.
 *
 * ⚠️ `code` ganha da combinação inteira — mono não tem itálico nem negrito no par do projeto, e
 * fingir um com outra família quebraria o alinhamento tabular que é o ponto do JetBrains Mono.
 */
export function faceKey(marks: readonly Mark[], base: 400 | 500 | 600 = 400): FaceKey {
  if (marks.includes('code')) return 'mono';

  const peso = marks.includes('bold') ? 700 : base;
  if (marks.includes('italic')) {
    if (peso === 700) return 'boldItalic';
    if (peso === 600) return 'semiboldItalic';
    return 'italic';
  }
  if (peso === 700) return 'bold';
  if (peso === 600) return 'semibold';
  if (peso === 500) return 'medium';
  return 'regular';
}

/** `~riscado~` é decoração de texto, não família — a mesma linha do item marcável feito. */
export function strikeOf(marks: readonly Mark[]): 'line-through' | undefined {
  return marks.includes('strike') ? 'line-through' : undefined;
}
