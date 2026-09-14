/**
 * Normalização de texto para BUSCA e agrupamento — um lugar só.
 *
 * ⚠️ **Já existiam DUAS cópias privadas** desta linha (`accounts.ts` e `categories-merge.ts`), e
 * a terceira ia nascer na busca das recorrentes. Normalizador duplicado é a classe de defeito que
 * não dá erro: uma cópia ganha `.trim()`, a outra não, e a mesma palavra passa a casar numa tela
 * e não casar na vizinha.
 */
export const semAcento = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
