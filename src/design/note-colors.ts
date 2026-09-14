/**
 * A cor e a face de uma nota — o lado do DESENHO da paleta que vive em `constants/theme.ts`.
 *
 * Duas perguntas, um arquivo:
 *
 * 1. **Que tinta essa nota/pasta usa neste tema?** (`noteInk`, `noteTile`, `noteRail`)
 * 2. **Que FACE de fonte esse trecho de texto precisa?** (`noteFace`)
 *
 * Nenhum hex nasce aqui — `NoteColors` é a fonte, e a mistura com a superfície reaproveita
 * `blend`/`alpha` de `card-brands.ts`, que já existem e já são a aritmética de cor do projeto.
 */

import { Fonts, NoteColors, type NoteColorName } from '@/constants/theme';
import { alpha, blend } from '@/design/card-brands';
import { faceKey } from '@/design/note-face';
import type { Mark } from '@/lib/note-inline';

export type { NoteColorName };

/** O que o banco guarda: um dos oito nomes, ou nada. */
export type NoteColorValue = NoteColorName | null;

export function isNoteColor(value: string | null | undefined): value is NoteColorName {
  return !!value && value in NoteColors.light;
}

/** A tinta cheia — o trilho do cartão, o ponto na linha, a borda do ladrilho selecionado. */
export function noteInk(color: NoteColorValue, scheme: 'light' | 'dark'): string | null {
  return isNoteColor(color) ? NoteColors[scheme][color] : null;
}

/**
 * O fundo do LADRILHO do ícone da pasta.
 *
 * Misturado com a superfície, nunca com preto: `card-brands.ts` documenta o mesmo erro — puxar
 * para o preto puro fazia o bloco sumir dentro do fundo quase-preto do tema escuro. 18% é o que
 * dá um ladrilho reconhecível a um metro de distância sem competir com o accent.
 */
export function noteTile(
  color: NoteColorValue,
  surface: string,
  scheme: 'light' | 'dark'
): string | null {
  const ink = noteInk(color, scheme);
  return ink ? blend(ink, surface, 0.18) : null;
}

/** O trilho de 3px na borda do cartão. Tinta cheia: 3px de cor lavada não é cor nenhuma. */
export function noteRail(color: NoteColorValue, scheme: 'light' | 'dark'): string | null {
  return noteInk(color, scheme);
}

/** O anel da amostra selecionada no seletor de cor. */
export function noteRing(color: NoteColorValue, scheme: 'light' | 'dark'): string | null {
  const ink = noteInk(color, scheme);
  return ink ? alpha(ink, 0.4) : null;
}

/**
 * A FACE exata para um trecho de texto com marcas inline.
 *
 * A matriz mora em `note-face.ts`, pura e testada; aqui só a tradução chave → nome do arquivo de
 * fonte. As seis faces têm de estar no `useFonts` do `_layout.tsx` raiz: face que ninguém carrega
 * **não cai no system font, ela some** — e `anti-slop.test.ts` quebra o build se uma faltar.
 */
export function noteFace(marks: readonly Mark[], base: 400 | 500 | 600 = 400): string {
  return Fonts[faceKey(marks, base)];
}

export { strikeOf as noteStrike } from '@/design/note-face';
