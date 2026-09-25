/**
 * A cor e a face de uma nota — o lado do DESENHO da paleta que vive em `constants/theme.ts`.
 *
 * Duas perguntas, um arquivo:
 *
 * 1. **Que tinta essa nota/pasta usa neste tema?** (`noteInk`, `notePalette`)
 * 2. **Que FACE de fonte esse trecho de texto precisa?** (`noteFace`)
 *
 * Nenhum hex nasce aqui — `NoteColors` é a fonte, e a mistura com a superfície é
 * `note-surface.ts`, sobre o `blend` de `card-brands.ts`.
 */

import { Fonts, NoteColors, type NoteColorName, type Palette } from '@/constants/theme';
import { alpha } from '@/design/card-brands';
import { faceKey } from '@/design/note-face';
import { superficieDaNota } from '@/design/note-surface';
import type { Mark } from '@/lib/note-inline';

export type { NoteColorName };

/** O que o banco guarda: um dos oito nomes, ou nada. */
export type NoteColorValue = NoteColorName | null;

export function isNoteColor(value: string | null | undefined): value is NoteColorName {
  return !!value && value in NoteColors.light;
}

/** A tinta cheia — o disco do editor, o ponto na linha, o anel da amostra. */
export function noteInk(color: NoteColorValue, scheme: 'light' | 'dark'): string | null {
  return isNoteColor(color) ? NoteColors[scheme][color] : null;
}

/**
 * A paleta de uma nota (ou pasta) COLORIDA, para o `PaletaTingida` do cartão e do editor.
 *
 * A cor pinta o cartão INTEIRO desde 25/09/2026 (decisão do dono do produto: *"o card inteiro
 * tem que ficar daquela cor e não somente um detalhe quase imperceptível"*); antes era um trilho
 * de 3px e um ladrilho no ícone da pasta. Troca a superfície, o cinza secundário (que sobre o
 * fundo tingido perderia o contraste) e os tons de chip, borda e tocado — o resto do tema fica.
 * `base` é a paleta do tema, a de FORA do cartão.
 */
export function notePalette(
  color: NoteColorValue,
  scheme: 'light' | 'dark',
  base: { surface: string; text: string }
): Partial<Palette> | null {
  const ink = noteInk(color, scheme);
  if (!ink) return null;
  const s = superficieDaNota(ink, scheme, base);
  return {
    surface: s.fundo,
    background: s.fundo,
    textSecondary: s.secundario,
    backgroundSelected: s.forte,
    backgroundElement: s.forte,
    accentSoft: s.forte,
    cardBorder: s.forte,
  };
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
