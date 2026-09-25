import { blend } from './card-brands.ts';

/**
 * A superfície de uma nota (ou pasta) COLORIDA: o cartão inteiro e o fundo do editor.
 *
 * Era um trilho de 3px, e o dono do produto recusou em 25/09/2026: *"o card inteiro tem que
 * ficar daquela cor e não somente um detalhe quase imperceptível, o intuito é melhorar a
 * identificação"*. O modelo é o do Google Keep: pastel no claro, tom fundo no escuro.
 *
 * Misturado com a SUPERFÍCIE do tema, nunca com preto ou branco puro (a lição do `card-brands`).
 * O peso é maior no escuro porque a tinta do escuro (tom 80) sobre quase-preto some antes.
 *
 * ⚠️ **O cinza secundário do tema não serve aqui.** Sobre o fundo tingido ele cai abaixo de
 * 4,5:1 em metade das cores (oceano no claro: 3,9). `secundario` é o texto do tema puxado para o
 * fundo — lê como cinza daquela cor e passa de 5:1 nas oito, medido em `note-surface.test.ts`.
 */
const PESO = { light: 0.22, dark: 0.26 } as const;

export type SuperficieDaNota = {
  /** O cartão / o fundo do editor. */
  fundo: string;
  /** Tocado ou arrastado, a borda e a pílula da pasta: o mesmo tom, mais forte. */
  forte: string;
  /** Texto secundário (prévia, data, contagem) sobre `fundo`. */
  secundario: string;
};

export function superficieDaNota(
  tinta: string,
  scheme: 'light' | 'dark',
  base: { surface: string; text: string }
): SuperficieDaNota {
  const fundo = blend(tinta, base.surface, PESO[scheme]);
  return {
    fundo,
    forte: blend(tinta, base.surface, PESO[scheme] * 1.8),
    secundario: blend(base.text, fundo, 0.7),
  };
}
