import { formatBRL } from './dates.ts';

/**
 * Quantos glifos o `TextInput` do herói comporta: 13 (`R$ 999.999,99`), MEDIDO a 384dp com a fonte
 * do sistema em 1,3×. `TextInput` não tem `adjustsFontSizeToFit`, e o painel corta o que passa.
 */
const MAX_GLIFOS = 13;
const ESCALA_MEDIDA = 1.3;

/**
 * O valor animado cabe? A fonte do sistema entra na conta: acima da escala medida cada glifo é
 * mais largo, e o que não cabe vai para o `<Money>`, que encolhe (29/09/2026: em
 * accessibility-large, "R$ 32.227,69" ficava só "R$"). Abaixo dela a régua não afrouxa.
 */
export function valorAnimadoCabe(cents: number, fontScale: number): boolean {
  const glifos = formatBRL(Math.abs(cents)).length + (cents < 0 ? 1 : 0);
  return glifos * Math.max(fontScale / ESCALA_MEDIDA, 1) <= MAX_GLIFOS;
}
